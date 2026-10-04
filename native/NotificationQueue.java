package com.finanalyzer.app;

import android.content.Context;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONObject;

// Durable disk queue; no silent eviction when the UI has not been opened.
final class NotificationQueue extends SQLiteOpenHelper {
    private static NotificationQueue instance;
    static synchronized NotificationQueue get(Context ctx) {
        if (instance == null) instance = new NotificationQueue(ctx.getApplicationContext());
        return instance;
    }
    private NotificationQueue(Context ctx) { super(ctx, "notification_queue.db", null, 1); }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE events (_id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL, ts INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(event_key, ts))");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { }
    synchronized void put(JSONObject item) throws Exception {
        SQLiteDatabase db = getWritableDatabase();
        String key = item.optString("key", "legacy:" + item.toString().hashCode());
        long ts = item.optLong("ts");
        ContentValues values = new ContentValues();
        values.put("event_key", key); values.put("ts", ts); values.put("payload", item.toString());
        int updated = db.update("events", values, "event_key=? AND ts=?", new String[]{key, String.valueOf(ts)});
        if (updated == 0 && db.insertOrThrow("events", null, values) < 0) throw new IllegalStateException("Queue write failed");
    }
    synchronized void migrate(Context context) throws Exception {
        android.content.SharedPreferences prefs = context.getSharedPreferences("bank_notifs", Context.MODE_PRIVATE);
        if (prefs.getBoolean("sqliteMigrated", false)) return;
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            JSONArray old = new JSONArray(prefs.getString("items", "[]"));
            for (int i=0; i<old.length(); i++) put(old.getJSONObject(i));
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        prefs.edit().remove("items").putBoolean("sqliteMigrated", true).commit();
    }
    synchronized JSONObject page(long after) throws Exception {
        JSONArray items = new JSONArray(); long next=after; boolean more=false;
        try (Cursor c = getReadableDatabase().query("events", new String[]{"_id", "payload"}, "_id > ?",
                new String[]{String.valueOf(after)}, null, null, "_id ASC", "251")) {
            while (c.moveToNext()) {
                if (items.length() == 250) { more=true; break; }
                next=c.getLong(0);
                JSONObject item = new JSONObject(c.getString(1));
                item.put("queueId", String.valueOf(next)); items.put(item);
            }
        }
        return new JSONObject().put("items", items.toString()).put("after", String.valueOf(next)).put("more", more);
    }
    synchronized void clear() { getWritableDatabase().delete("events", null, null); }
    synchronized void acknowledge(JSONArray items) throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            for (int i=0; i<items.length(); i++) {
                JSONObject item=items.getJSONObject(i);
                // Exact payload check avoids deleting an expanded notification received after reading.
                String id=item.optString("queueId"); item.remove("queueId");
                try (Cursor c = db.query("events", new String[]{"payload"}, "_id=?", new String[]{id}, null, null, null)) {
                    if (c.moveToFirst()) {
                        JSONObject current = new JSONObject(c.getString(0));
                        boolean same = true;
                        for (String field : new String[]{"pkg", "title", "text", "ts", "key"}) {
                            if (!current.optString(field).equals(item.optString(field))) { same = false; break; }
                        }
                        if (same) db.delete("events", "_id=?", new String[]{id});
                    }
                }
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
}

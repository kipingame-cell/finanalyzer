package com.finanalyzer.app;

import android.app.Notification;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Parcelable;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;

// Persist first: Android can deliver notifications while the WebView is stopped.
public class BankNotificationService extends NotificationListenerService {
    static final Object QUEUE_LOCK = new Object();

    static void append(Context context, String pkg, String title, String text, long ts, String key) throws Exception {
        if (title.isEmpty() && text.isEmpty()) return;
        synchronized (QUEUE_LOCK) {
            SharedPreferences sp = context.getSharedPreferences("bank_notifs", MODE_PRIVATE);
            JSONArray arr = new JSONArray(sp.getString("items", "[]"));
            for (int i = arr.length() - 1; i >= 0; i--) {
                JSONObject old = arr.optJSONObject(i);
                if (old != null && key.equals(old.optString("key")) && ts == old.optLong("ts")) {
                    if (title.equals(old.optString("title")) && text.equals(old.optString("text"))) return;
                    arr.remove(i); // replace expanded versions of the same notification
                }
            }
            JSONObject item = new JSONObject();
            item.put("pkg", pkg); item.put("title", title); item.put("text", text);
            item.put("ts", ts); item.put("key", key);
            arr.put(item);
            while (arr.length() > 2000) arr.remove(0);
            if (!sp.edit().putString("items", arr.toString()).commit())
                throw new IllegalStateException("Notification queue write failed");
        }
    }

    @Override public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            Notification n = sbn.getNotification();
            if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0 || n.extras == null) return;
            Bundle extras = n.extras;
            String title = str(extras.getCharSequence(Notification.EXTRA_TITLE));
            Parcelable[] messages = extras.getParcelableArray(Notification.EXTRA_MESSAGES);
            if (messages != null && messages.length > 0) {
                for (Parcelable parcel : messages) {
                    if (!(parcel instanceof Bundle)) continue;
                    Bundle message = (Bundle) parcel;
                    String body = str(message.getCharSequence("text"));
                    if (body.isEmpty()) continue;
                    String sender = str(message.getCharSequence("sender"));
                    long time = message.getLong("time", sbn.getPostTime());
                    append(this, sbn.getPackageName(), sender.isEmpty() ? title : sender, body,
                           time, sbn.getKey() + ":message:" + time);
                }
                return;
            }
            String text = str(extras.getCharSequence(Notification.EXTRA_TEXT));
            String big = str(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
            if (!big.isEmpty()) text = big;
            if (text.isEmpty()) {
                CharSequence[] lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
                if (lines != null) text = android.text.TextUtils.join("\n", lines);
            }
            append(this, sbn.getPackageName(), title, text, sbn.getPostTime(), sbn.getKey());
        } catch (Exception error) {
            Log.e("FinAnalyzer", "Unable to persist notification", error);
        }
    }
    private static String str(CharSequence value) { return value == null ? "" : value.toString(); }
}

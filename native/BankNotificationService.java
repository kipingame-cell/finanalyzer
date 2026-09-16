package com.finanalyzer.app;

import android.app.Notification;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONObject;

// Системная служба: ловит уведомления (банки, кошельки) и складывает в SharedPreferences.
// Веб-слой забирает их через NotificationListenerPlugin и сам решает, что из этого трата.
public class BankNotificationService extends NotificationListenerService {

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            Notification n = sbn.getNotification();
            if (n == null) return;
            Bundle e = n.extras;
            if (e == null) return;
            String title = str(e.getCharSequence(Notification.EXTRA_TITLE));
            String text = str(e.getCharSequence(Notification.EXTRA_TEXT));
            String big = str(e.getCharSequence(Notification.EXTRA_BIG_TEXT));
            if (big.length() > text.length()) text = big;
            if (title.isEmpty() && text.isEmpty()) return;

            SharedPreferences sp = getSharedPreferences("bank_notifs", MODE_PRIVATE);
            JSONArray arr = new JSONArray(sp.getString("items", "[]"));
            JSONObject o = new JSONObject();
            o.put("pkg", sbn.getPackageName());
            o.put("title", title);
            o.put("text", text);
            o.put("ts", sbn.getPostTime());
            arr.put(o);
            while (arr.length() > 300) arr.remove(0);
            sp.edit().putString("items", arr.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    private String str(CharSequence cs) {
        return cs == null ? "" : cs.toString();
    }
}

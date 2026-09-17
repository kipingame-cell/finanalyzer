package com.finanalyzer.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Set;

@CapacitorPlugin(name = "NotificationListener")
public class NotificationListenerPlugin extends Plugin {

    @PluginMethod
    public void isEnabled(PluginCall call) {
        Context ctx = getContext();
        Set<String> pkgs = NotificationManagerCompat.getEnabledListenerPackages(ctx);
        JSObject ret = new JSObject();
        ret.put("enabled", pkgs.contains(ctx.getPackageName()));
        call.resolve(ret);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent i = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void getNotifications(PluginCall call) {
        SharedPreferences sp = getContext().getSharedPreferences("bank_notifs", Context.MODE_PRIVATE);
        JSObject ret = new JSObject();
        ret.put("items", sp.getString("items", "[]"));
        call.resolve(ret);
    }

    @PluginMethod
    public void clearNotifications(PluginCall call) {
        getContext().getSharedPreferences("bank_notifs", Context.MODE_PRIVATE)
                .edit().putString("items", "[]").apply();
        call.resolve();
    }

    // Диагностика: вставляет фейковое банковское уведомление в то же хранилище,
    // куда пишет служба. Если после этого веб-слой его видит и распознаёт —
    // вся цепочка (служба→prefs→плагин→парсер) жива, и проблема на стороне банка.
    @PluginMethod
    public void injectTest(PluginCall call) {
        try {
            SharedPreferences sp = getContext().getSharedPreferences("bank_notifs", Context.MODE_PRIVATE);
            org.json.JSONArray arr = new org.json.JSONArray(sp.getString("items", "[]"));
            org.json.JSONObject o = new org.json.JSONObject();
            String stamp = new java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US)
                    .format(new java.util.Date());
            o.put("pkg", "ru.sberbankmobile");
            o.put("title", "СберБанк");
            o.put("text", "Покупка 450,00 ₽, ТЕСТ-МАГАЗИН. Баланс: 12 340,55 ₽ (тест " + stamp + ")");
            o.put("ts", System.currentTimeMillis());
            arr.put(o);
            while (arr.length() > 300) arr.remove(0);
            sp.edit().putString("items", arr.toString()).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("inject failed", e);
        }
    }
}

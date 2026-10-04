package com.finanalyzer.app;

import android.Manifest;
import android.database.Cursor;
import android.provider.Telephony;
import android.provider.Settings;
import android.net.Uri;
import android.os.PowerManager;
import android.os.Build;
import android.content.ComponentName;
import android.service.notification.NotificationListenerService;
import com.getcapacitor.PermissionState;
import com.getcapacitor.JSArray;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
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

@CapacitorPlugin(name = "NotificationListener", permissions = {
    @Permission(alias = "sms", strings = {Manifest.permission.READ_SMS})
})
public class NotificationListenerPlugin extends Plugin {

    @PluginMethod
    public void readSmsHistory(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            requestPermissionForAlias("sms", call, "smsPermissionResult");
            return;
        }
        readSmsPage(call);
    }

    @PermissionCallback
    private void smsPermissionResult(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) readSmsPage(call);
        else call.reject("Нет доступа к SMS. Разрешите SMS в настройках приложения. Если переключатель недоступен, Android или установщик ограничил это разрешение.", "SMS_PERMISSION_DENIED");
    }

    private void readSmsPage(PluginCall call) {
        // No date cutoff: page through the entire on-device inbox by stable SMS id.
        getBridge().execute(() -> {
            try {
                long after = Long.parseLong(call.getString("after", "0"));
                long upper = Long.parseLong(call.getString("upper", "0"));
                if (upper == 0) {
                    try (Cursor c = getContext().getContentResolver().query(Telephony.Sms.Inbox.CONTENT_URI,
                            new String[]{"_id"}, null, null, "_id DESC")) {
                        if (c != null && c.moveToFirst()) upper = c.getLong(0);
                    }
                }
                JSArray items = new JSArray();
                long next = after;
                boolean more = false;
                try (Cursor c = getContext().getContentResolver().query(Telephony.Sms.Inbox.CONTENT_URI,
                        new String[]{"_id", "address", "body", "date"}, "_id > ? AND _id <= ?",
                        new String[]{String.valueOf(after), String.valueOf(upper)}, "_id ASC")) {
                    if (c == null) throw new IllegalStateException("SMS provider unavailable");
                    while (c.moveToNext()) {
                        if (items.length() >= 250) { more = true; break; }
                        next = c.getLong(0);
                        JSObject item = new JSObject();
                        item.put("pkg", "com.android.mms");
                        item.put("title", c.getString(1)); item.put("text", c.getString(2));
                        item.put("ts", c.getLong(3)); item.put("key", "sms:" + next);
                        item.put("smsId", String.valueOf(next)); items.put(item);
                    }
                }
                JSObject ret = new JSObject();
                ret.put("items", items); ret.put("after", String.valueOf(next));
                ret.put("upper", String.valueOf(upper)); ret.put("more", more);
                call.resolve(ret);
            } catch (SecurityException e) { call.reject("Android запретил чтение SMS. Проверьте разрешение SMS в настройках приложения.", "SMS_PERMISSION_DENIED", e); }
            catch (Exception e) { call.reject("Не удалось прочитать историю SMS", e); }
        });
    }

    @PluginMethod
    public void backgroundStatus(PluginCall call) {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        JSObject ret = new JSObject();
        ret.put("connected", BankNotificationService.connected);
        ret.put("unrestricted", Build.VERSION.SDK_INT < 23 || pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        ret.put("lastCapture", getContext().getSharedPreferences("bank_notifs", Context.MODE_PRIVATE).getLong("lastCapture", 0));
        call.resolve(ret);
    }

    @PluginMethod
    public void openBackgroundSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            if (Build.VERSION.SDK_INT >= 24) NotificationListenerService.requestRebind(
                    new ComponentName(getContext(), BankNotificationService.class));
            call.resolve();
        } catch (Exception e) { call.reject("Не удалось открыть настройки", e); }
    }

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
        try {
            synchronized (BankNotificationService.QUEUE_LOCK) {
                NotificationQueue q = NotificationQueue.get(getContext()); q.migrate(getContext());
                org.json.JSONObject page = q.page(Long.parseLong(call.getString("after", "0")));
                JSObject ret = new JSObject();
                ret.put("items", page.getString("items")); ret.put("after", page.getString("after")); ret.put("more", page.getBoolean("more"));
                call.resolve(ret);
            }
        } catch (Exception e) { call.reject("Не удалось прочитать очередь уведомлений", e); }
    }

    @PluginMethod
    public void acknowledgeNotifications(PluginCall call) {
        try {
            JSArray items = call.getArray("items", new JSArray());
            NotificationQueue.get(getContext()).acknowledge(items);
            call.resolve();
        } catch (Exception e) { call.reject("Не удалось подтвердить уведомления", e); }
    }

    @PluginMethod
    public void clearNotifications(PluginCall call) {
        try {
            synchronized (BankNotificationService.QUEUE_LOCK) {
                NotificationQueue q = NotificationQueue.get(getContext()); q.migrate(getContext()); q.clear();
            }
            call.resolve();
        } catch (Exception e) { call.reject("Не удалось очистить очередь", e); }
    }

    // Диагностика: вставляет фейковое банковское уведомление в то же хранилище,
    // куда пишет служба. Если после этого веб-слой его видит и распознаёт —
    // вся цепочка (служба→prefs→плагин→парсер) жива, и проблема на стороне банка.
    @PluginMethod
    public void injectTest(PluginCall call) {
        try {
            long now = System.currentTimeMillis();
            BankNotificationService.append(getContext(), "ru.sberbankmobile", "СберБанк",
                    "Покупка 450,00 ₽, ТЕСТ-МАГАЗИН. Баланс: 12 340,55 ₽", now, "test:" + now);
            call.resolve();
        } catch (Exception e) {
            call.reject("inject failed", e);
        }
    }
}

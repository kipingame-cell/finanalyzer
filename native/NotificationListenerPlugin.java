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
}

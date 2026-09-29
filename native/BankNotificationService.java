package com.finanalyzer.app;

import android.app.Notification;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

// Системная служба: ловит уведомления (банки, кошельки) и складывает в SharedPreferences.
// Веб-слой забирает их через NotificationListenerPlugin и сам решает, что из этого трата.
public class BankNotificationService extends NotificationListenerService {
    private static final Set<String> BANK_PACKAGES = new HashSet<>(Arrays.asList(
            "ru.sberbankmobile", "com.idamob.tinkoff.android", "ru.alfabank.mobile.android",
            "ru.vtb24.mobilebanking.android", "ru.ftc.faktura.raiffeisen", "ru.openbank",
            "ru.rosbank.android", "ru.otpbank.mobile", "com.sovkombank.mobile",
            "ru.gazprombank.android.mobilebank.app", "ru.mts.money", "ru.mtsbank",
            "ru.letobank.Prometheus", "ru.yandex.bank", "ru.yandex.pay",
            "ru.ozon.app.android", "com.wildberries.ru", "ru.psb.mobile",
            "ru.ubrr.mobile", "ru.akbars.mobile", "ru.rnkb.dbo", "ru.dom.rfbank"));
    private static final Set<String> SMS_PACKAGES = new HashSet<>(Arrays.asList(
            "com.google.android.apps.messaging", "com.android.messaging", "com.android.mms",
            "com.samsung.android.messaging", "ru.samsung.android.messaging", "com.miui.smsextra"));
    private static final Pattern AMOUNT = Pattern.compile("\\d[\\d ,.\\u00a0\\u202f]*\\s*(?:₽|руб|rub|rur|[рp](?![a-zа-я]))", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern SECRET = Pattern.compile("одноразов|подтверждени|парол|никому не сообщайте|код[: ]", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        getSharedPreferences("bank_notifs", MODE_PRIVATE).edit()
                .putLong("connectedAt", System.currentTimeMillis())
                .putBoolean("connected", true).apply();
    }

    @Override
    public void onListenerDisconnected() {
        getSharedPreferences("bank_notifs", MODE_PRIVATE).edit()
                .putBoolean("connected", false).apply();
        super.onListenerDisconnected();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            SharedPreferences sp = getSharedPreferences("bank_notifs", MODE_PRIVATE);
            String pkg = sbn.getPackageName();
            // Диагностика сохраняет только имя пакета и время, без содержимого чужих уведомлений.
            JSONObject observed = new JSONObject(sp.getString("observed", "{}"));
            JSONObject source = observed.optJSONObject(pkg);
            if (source == null) source = new JSONObject();
            source.put("count", source.optInt("count") + 1);
            source.put("lastAt", System.currentTimeMillis());
            observed.put(pkg, source);
            sp.edit().putString("observed", observed.toString())
                    .putLong("lastCallbackAt", System.currentTimeMillis()).apply();
            Notification n = sbn.getNotification();
            if (n == null) return;
            Bundle e = n.extras;
            if (e == null) return;
            String title = str(e.getCharSequence(Notification.EXTRA_TITLE));
            String text = str(e.getCharSequence(Notification.EXTRA_TEXT));
            String big = str(e.getCharSequence(Notification.EXTRA_BIG_TEXT));
            if (big.length() > text.length()) text = big;
            CharSequence[] lines = e.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
            if (lines != null) {
                StringBuilder joined = new StringBuilder();
                for (CharSequence line : lines) if (line != null) joined.append(line).append(' ');
                if (joined.length() > text.length()) text = joined.toString().trim();
            }
            if (text.isEmpty()) text = str(e.getCharSequence(Notification.EXTRA_SUB_TEXT));
            if (text.isEmpty()) text = str(n.tickerText);
            if (title.isEmpty() && text.isEmpty()) return;
            boolean selected = sp.getStringSet("allowedPackages", new HashSet<String>()).contains(pkg);
            if (!BANK_PACKAGES.contains(pkg) && !SMS_PACKAGES.contains(pkg) && !selected) return;
            // Для SMS-пакетов исключаем личную переписку: только известный отправитель банка.
            if (SMS_PACKAGES.contains(pkg) && !selected && !title.matches("(?i).*(?:900|сбер|tinkoff|тинькофф|т-банк|втб|альфа|газпромбанк|райффайзен|мтс банк|почта банк|совкомбанк|ozon банк|яндекс банк).*")) return;
            String full = title + " " + text;
            // Оставляем неизвестные форматы операций для диагностики в приложении.
            if (!AMOUNT.matcher(full).find() || SECRET.matcher(full).find()) return;

            JSONArray arr = new JSONArray(sp.getString("items", "[]"));
            JSONObject o = new JSONObject();
            o.put("pkg", pkg);
            o.put("key", sbn.getKey());
            o.put("title", title);
            o.put("text", text);
            o.put("ts", sbn.getPostTime());
            // Повторное обновление одного системного уведомления заменяет его запись.
            for (int i = arr.length() - 1; i >= 0; i--) {
                JSONObject old = arr.optJSONObject(i);
                if (old != null && sbn.getKey().equals(old.optString("key")) && sbn.getPostTime() == old.optLong("ts")) arr.remove(i);
            }
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

package com.opradopedro.agenda;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Agenda cada aviso no AlarmManager. "Alarme exato" é só o nome do agendamento
 * que dispara no minuto certo mesmo com o celular em economia de bateria;
 * quem decide se toca como despertador é o tipo do aviso (Notifier).
 */
final class Scheduler {
    private Scheduler() {}

    static boolean canExact(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
    }

    static synchronized int scheduleAll(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        // cancela o que estava agendado
        JSONArray old = Store.codes(c);
        for (int i = 0; i < old.length(); i++) {
            PendingIntent pi = PendingIntent.getBroadcast(c, old.optInt(i), new Intent(c, AlarmReceiver.class),
                    PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
            if (pi != null) {
                am.cancel(pi);
                pi.cancel();
            }
        }
        JSONArray items = Store.items(c);
        JSONArray codes = new JSONArray();
        long now = System.currentTimeMillis();
        boolean exact = canExact(c);
        int count = 0;
        for (int i = 0; i < items.length() && count < 400; i++) {
            JSONObject it = items.optJSONObject(i);
            if (it == null) continue;
            long at = it.optLong("at");
            if (at <= now) continue;
            int code = (it.optString("blockId") + "|" + it.optString("kind") + "|" + at).hashCode();
            Intent intent = new Intent(c, AlarmReceiver.class).putExtra("item", it.toString());
            PendingIntent pi = PendingIntent.getBroadcast(c, code, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            if (it.optBoolean("alarm")) {
                // despertador: setAlarmClock é exato e sempre permitido para alarmes
                Intent show = new Intent(c, MainActivity.class).putExtra("route", "checkin/" + it.optString("blockId"));
                PendingIntent showPi = PendingIntent.getActivity(c, code, show, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, showPi), pi);
            } else if (exact) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            }
            codes.put(code);
            count++;
        }
        Store.setCodes(c, codes);
        return count;
    }
}

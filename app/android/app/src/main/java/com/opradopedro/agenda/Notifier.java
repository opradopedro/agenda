package com.opradopedro.agenda;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONObject;

/** Mostra os avisos. Um só por vez: todos usam o mesmo id e se substituem. */
final class Notifier {
    static final int ID = 1001;
    static final String CH_REMINDER = "lembretes";
    static final String CH_SILENT = "lembretes_silenciosos";
    static final String CH_ALARM = "alarmes";

    private Notifier() {}

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel reminder = new NotificationChannel(CH_REMINDER, "Lembretes", NotificationManager.IMPORTANCE_DEFAULT);
        reminder.setDescription("Início e fim das tarefas, com um toque curto");
        NotificationChannel silent = new NotificationChannel(CH_SILENT, "Lembretes silenciosos", NotificationManager.IMPORTANCE_LOW);
        silent.setDescription("Modo silencioso: sem som e sem vibrar");
        NotificationChannel alarm = new NotificationChannel(CH_ALARM, "Alarmes", NotificationManager.IMPORTANCE_HIGH);
        alarm.setDescription("Tarefas marcadas como alarme: tocam até você responder");
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        alarm.setSound(sound, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        alarm.enableVibration(true);
        alarm.setBypassDnd(true);
        nm.createNotificationChannel(reminder);
        nm.createNotificationChannel(silent);
        nm.createNotificationChannel(alarm);
    }

    private static PendingIntent openApp(Context c, int req, String route, String action, String blockId, boolean alarm) {
        Intent i = new Intent(c, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra("route", route)
                .putExtra("alarm", alarm);
        if (action != null) i.putExtra("action", action).putExtra("blockId", blockId);
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void show(Context c, JSONObject it) {
        ensureChannels(c);
        String blockId = it.optString("blockId", "");
        String kind = it.optString("kind", "inicio");
        boolean alarm = it.optBoolean("alarm");
        boolean silent = it.optBoolean("silent");
        String channel = alarm ? CH_ALARM : silent ? CH_SILENT : CH_REMINDER;
        String route = blockId.isEmpty() ? "hoje" : "checkin/" + blockId;

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, channel)
                .setSmallIcon(R.drawable.ic_stat_agenda)
                .setContentTitle(it.optString("title"))
                .setContentText(it.optString("body"))
                .setStyle(new NotificationCompat.BigTextStyle().bigText(it.optString("body")))
                .setContentIntent(openApp(c, 1, route, null, blockId, alarm))
                .setAutoCancel(true)
                .setOnlyAlertOnce(false)
                .setCategory(alarm ? NotificationCompat.CATEGORY_ALARM : NotificationCompat.CATEGORY_REMINDER)
                .setPriority(alarm ? NotificationCompat.PRIORITY_MAX : silent ? NotificationCompat.PRIORITY_LOW : NotificationCompat.PRIORITY_DEFAULT);

        if ("fim".equals(kind) || alarm) {
            Intent done = new Intent(c, ActionReceiver.class).putExtra("blockId", blockId).putExtra("action", "terminei");
            b.addAction(0, "Terminei", PendingIntent.getBroadcast(c, 2, done, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            b.addAction(0, "Mais tempo", openApp(c, 3, route, "mais_tempo", blockId, false));
            b.addAction(0, "Remarcar", openApp(c, 4, route, "remarcar", blockId, false));
        }
        if (alarm) {
            b.setFullScreenIntent(openApp(c, 5, route, null, blockId, true), true);
            b.setOngoing(true);
        }
        Notification n = b.build();
        if (alarm) n.flags |= Notification.FLAG_INSISTENT; // repete o som até alguém mexer
        try {
            NotificationManagerCompat.from(c).notify(ID, n);
        } catch (SecurityException ignored) {
            // sem permissão de notificação: nada a fazer
        }
    }

    static void cancel(Context c) {
        NotificationManagerCompat.from(c).cancel(ID);
    }
}

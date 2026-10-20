package com.opradopedro.agenda;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONException;
import org.json.JSONObject;

/** Hora do aviso: mostra a notificação. */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String raw = intent.getStringExtra("item");
        if (raw == null) return;
        try {
            Notifier.show(context, new JSONObject(raw));
        } catch (JSONException ignored) {
        }
    }
}

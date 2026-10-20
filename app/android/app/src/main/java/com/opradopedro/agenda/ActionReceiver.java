package com.opradopedro.agenda;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * "Terminei" pela notificação, sem abrir o app: guarda a resposta; o app aplica
 * na hora se estiver aberto, ou quando abrir.
 */
public class ActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String blockId = intent.getStringExtra("blockId");
        String action = intent.getStringExtra("action");
        if (blockId == null || action == null) return;
        Store.addAction(context, blockId, action);
        Notifier.cancel(context);
        AgendaNativePlugin.deliverPending();
    }
}

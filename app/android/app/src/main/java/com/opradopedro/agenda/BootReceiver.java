package com.opradopedro.agenda;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Reinício do celular, atualização do app ou mudança de hora: reagenda os avisos. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Scheduler.scheduleAll(context);
    }
}

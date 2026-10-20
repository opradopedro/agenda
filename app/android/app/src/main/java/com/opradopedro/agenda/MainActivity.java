package com.opradopedro.agenda;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** Aberto por uma notificação: o JS consome via AgendaNative.consumeLaunch(). */
    static String launchRoute;
    static String launchAction;
    static String launchBlock;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AgendaNativePlugin.class);
        super.onCreate(savedInstanceState);
        handle(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handle(intent);
    }

    private void handle(Intent intent) {
        if (intent == null) return;
        if (intent.getBooleanExtra("alarm", false) && Build.VERSION.SDK_INT >= 27) {
            // alarme: aparece por cima da tela de bloqueio
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        String route = intent.getStringExtra("route");
        if (route == null) return;
        launchRoute = route;
        launchAction = intent.getStringExtra("action");
        launchBlock = intent.getStringExtra("blockId");
        intent.removeExtra("route");
        if (launchAction != null) Notifier.cancel(this);
        AgendaNativePlugin.deliverLaunch();
    }
}

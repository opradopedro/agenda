package com.opradopedro.agenda;

import android.Manifest;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.speech.RecognizerIntent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;

/** Ponte entre o app (JS) e o Android: avisos, permissões, bateria e voz. */
@CapacitorPlugin(
        name = "AgendaNative",
        permissions = {@Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})}
)
public class AgendaNativePlugin extends Plugin {
    private static AgendaNativePlugin instance;

    @Override
    public void load() {
        instance = this;
        Notifier.ensureChannels(getContext());
    }

    /** Uma resposta chegou pela notificação ("Terminei"): avisa o JS para buscar. */
    static void deliverPending() {
        if (instance != null) instance.notifyListeners("actionsChanged", new JSObject(), true);
    }

    /** O app foi aberto por uma notificação (rota e, talvez, uma resposta). */
    static void deliverLaunch() {
        if (instance != null) instance.notifyListeners("launch", new JSObject(), true);
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        JSArray items = call.getArray("items", new JSArray());
        try {
            Store.setItems(getContext(), new JSONArray(items.toString()));
        } catch (JSONException e) {
            call.reject("lista inválida");
            return;
        }
        int n = Scheduler.scheduleAll(getContext());
        JSObject r = new JSObject();
        r.put("scheduled", n);
        r.put("exact", Scheduler.canExact(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void getPendingActions(PluginCall call) {
        JSObject r = new JSObject();
        r.put("actions", Store.takeActions(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void consumeLaunch(PluginCall call) {
        JSObject r = new JSObject();
        r.put("route", MainActivity.launchRoute);
        r.put("action", MainActivity.launchAction);
        r.put("blockId", MainActivity.launchBlock);
        MainActivity.launchRoute = null;
        MainActivity.launchAction = null;
        MainActivity.launchBlock = null;
        call.resolve(r);
    }

    @PluginMethod
    public void clearNotification(PluginCall call) {
        Notifier.cancel(getContext());
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context c = getContext();
        JSObject r = new JSObject();
        r.put("notifications", Build.VERSION.SDK_INT >= 33 ? getPermissionState("notifications").toString() : "granted");
        r.put("exactAlarms", Scheduler.canExact(c));
        boolean fullScreen = true;
        if (Build.VERSION.SDK_INT >= 34) fullScreen = c.getSystemService(NotificationManager.class).canUseFullScreenIntent();
        r.put("fullScreen", fullScreen);
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        r.put("batteryUnrestricted", pm.isIgnoringBatteryOptimizations(c.getPackageName()));
        r.put("manufacturer", Build.MANUFACTURER);
        r.put("model", Build.MODEL);
        r.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(r);
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject r = new JSObject();
            r.put("notifications", "granted");
            call.resolve(r);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsCallback");
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        JSObject r = new JSObject();
        r.put("notifications", getPermissionState("notifications").toString());
        call.resolve(r);
    }

    private void open(PluginCall call, Intent intent, Intent fallback) {
        try {
            getActivity().startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException e) {
            if (fallback != null) getActivity().startActivity(fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }

    private Uri pkg() {
        return Uri.parse("package:" + getContext().getPackageName());
    }

    private Intent appDetails() {
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg());
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < 31) {
            call.resolve();
            return;
        }
        open(call, new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg()), appDetails());
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < 34) {
            call.resolve();
            return;
        }
        open(call, new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg()), appDetails());
    }

    @PluginMethod
    public void requestIgnoreBattery(PluginCall call) {
        open(call, new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg()),
                new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        open(call, new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS), appDetails());
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        open(call, appDetails(), null);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        open(call, i, appDetails());
    }

    /** Aviso de teste daqui a `seconds` segundos, pelo mesmo caminho dos avisos reais. */
    @PluginMethod
    public void testNotification(PluginCall call) {
        boolean alarm = Boolean.TRUE.equals(call.getBoolean("alarm", false));
        int seconds = call.getInt("seconds", 10);
        try {
            JSONArray items = Store.items(getContext());
            JSONObject t = new JSONObject();
            t.put("blockId", "");
            t.put("kind", "fim");
            t.put("at", System.currentTimeMillis() + seconds * 1000L);
            t.put("title", alarm ? "Teste de alarme" : "Teste de lembrete");
            t.put("body", alarm ? "Toca até você responder. Use os botões para testar." : "É assim que os lembretes vão chegar.");
            t.put("alarm", alarm);
            t.put("silent", false);
            items.put(t);
            Store.setItems(getContext(), items);
            Scheduler.scheduleAll(getContext());
        } catch (JSONException ignored) {
        }
        call.resolve();
    }

    @PluginMethod
    public void listen(PluginCall call) {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
                .putExtra(RecognizerIntent.EXTRA_PROMPT, "Fale o que você precisa fazer");
        try {
            startActivityForResult(call, i, "listenResult");
        } catch (ActivityNotFoundException e) {
            call.reject("Reconhecimento de voz indisponível neste celular.");
        }
    }

    @ActivityCallback
    private void listenResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        ArrayList<String> texts = data == null ? null : data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (texts == null || texts.isEmpty()) {
            call.reject("cancelado");
            return;
        }
        JSObject r = new JSObject();
        r.put("text", texts.get(0));
        call.resolve(r);
    }
}

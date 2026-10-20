package com.opradopedro.agenda;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Guarda os avisos agendados e as respostas dadas pela notificação. */
final class Store {
    private static final String PREFS = "agenda_native";
    private static final String ITEMS = "items";
    private static final String CODES = "codes";
    private static final String ACTIONS = "pending_actions";

    private Store() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONArray items(Context c) {
        return parse(prefs(c).getString(ITEMS, "[]"));
    }

    static void setItems(Context c, JSONArray items) {
        prefs(c).edit().putString(ITEMS, items.toString()).apply();
    }

    static JSONArray codes(Context c) {
        return parse(prefs(c).getString(CODES, "[]"));
    }

    static void setCodes(Context c, JSONArray codes) {
        prefs(c).edit().putString(CODES, codes.toString()).apply();
    }

    static synchronized void addAction(Context c, String blockId, String action) {
        JSONArray list = parse(prefs(c).getString(ACTIONS, "[]"));
        try {
            JSONObject o = new JSONObject();
            o.put("blockId", blockId);
            o.put("action", action);
            o.put("at", System.currentTimeMillis());
            list.put(o);
        } catch (JSONException ignored) {
        }
        prefs(c).edit().putString(ACTIONS, list.toString()).apply();
    }

    static synchronized JSONArray takeActions(Context c) {
        JSONArray list = parse(prefs(c).getString(ACTIONS, "[]"));
        prefs(c).edit().putString(ACTIONS, "[]").apply();
        return list;
    }

    private static JSONArray parse(String s) {
        try {
            return new JSONArray(s);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }
}

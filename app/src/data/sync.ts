// Sincronização local ↔ nuvem (last-write-wins por linha).
//   1. envia exclusões (lápides) e linhas marcadas como alteradas;
//   2. pede ao servidor para sincronizar o Google Calendar;
//   3. baixa o que mudou desde o último cursor (updated_at do servidor).
import { db, asRemote, readTombstones, writeTombstones, SYNCED_TABLES, type SyncedTable } from "./db";
import { MAPS, PUSH_ORDER, fromServer, toServer } from "./syncMap";
import { normalizeSettings } from "./defaults";
import { getSettings } from "./routine";
import { supabase } from "../lib/supabase";
import { callFunction } from "../lib/api";
import type { Block, Settings } from "./types";

type Row = Record<string, unknown> & { id: string; _dirty?: number; updatedAt?: string };

export interface SyncState {
  running: boolean;
  lastAt: string | null;
  error: string | null;
}

let state: SyncState = { running: false, lastAt: null, error: null };
const listeners = new Set<(s: SyncState) => void>();
const set = (s: Partial<SyncState>) => {
  state = { ...state, ...s };
  listeners.forEach((l) => l(state));
};
export const syncState = () => state;
export const onSyncState = (fn: (s: SyncState) => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const kvGet = async <T,>(key: string): Promise<T | undefined> => (await db.kv.get(key))?.value as T | undefined;
const kvSet = (key: string, value: unknown) => db.kv.put({ key, value });

let inflight: Promise<void> | null = null;
/** Sincroniza agora (chamadas simultâneas reaproveitam a mesma execução). */
export function syncNow(): Promise<void> {
  inflight ??= run().finally(() => (inflight = null));
  return inflight;
}

async function run(): Promise<void> {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return;
  set({ running: true, error: null });
  try {
    await linkDevice(user.id);
    const pushed = await push(user.id);
    if (pushed.blocks || !(await kvGet<string>("sync.gcalAt"))) {
      await callFunction("gcal-sync", {}).catch(() => undefined); // sem Google conectado: ignora
      await kvSet("sync.gcalAt", new Date().toISOString());
    }
    const changedEvents = await pull();
    if (changedEvents) await afterEventsChanged();
    set({ lastAt: new Date().toISOString() });
  } catch (e) {
    set({ error: (e as Error).message });
  } finally {
    set({ running: false });
  }
}

/**
 * Primeiro login neste aparelho: se a nuvem já tem uma rotina, ela vale (os
 * dados de tarefas deste aparelho sobem junto). Se a nuvem está vazia, tudo
 * deste aparelho sobe.
 */
async function linkDevice(userId: string) {
  if ((await kvGet<string>("sync.user")) === userId) return;
  const { data: profile } = await supabase!.from("profiles").select("app_settings").eq("user_id", userId).maybeSingle();
  const remote = profile?.app_settings as Partial<Settings> | null;
  if (remote?.onboardingDone) {
    await asRemote(async () => {
      await db.places.clear();
      await db.travel.clear();
      await db.commitments.clear();
      await db.settings.put({ ...normalizeSettings(remote), id: "me" });
    });
  }
  // tudo o que existe aqui ainda não foi enviado para esta conta
  for (const t of SYNCED_TABLES) {
    if (t === "settings" && remote?.onboardingDone) continue;
    await db.table(t).toCollection().modify((r: Row) => void (r._dirty = 1));
  }
  writeTombstones([]);
  await kvSet("sync.cursors", {});
  await kvSet("sync.user", userId);
}

async function push(userId: string): Promise<{ blocks: number }> {
  const sb = supabase!;
  // exclusões
  const tomb = readTombstones();
  const failed: typeof tomb = [];
  for (const t of tomb) {
    if (t.table === "settings") continue;
    const { error } = await sb.from(MAPS[t.table].server).update({ deleted_at: new Date().toISOString() }).eq("id", t.id);
    if (error) failed.push(t);
  }
  writeTombstones([...failed, ...readTombstones().filter((t) => !tomb.some((x) => x.table === t.table && x.id === t.id))]);

  // configurações → profiles.app_settings
  const me = (await db.settings.get("me")) as (Settings & { _dirty?: number }) | undefined;
  if (me?._dirty) {
    const { _dirty, ...settings } = me;
    void _dirty;
    const { error } = await sb.from("profiles").upsert(
      { user_id: userId, app_settings: settings, timezone: settings.timezone, schedule_mode: settings.scheduleMode, onboarding_done: settings.onboardingDone },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(`perfil: ${error.message}`);
    await clearDirty("settings", [me as unknown as Row]);
  }

  let blocks = 0;
  for (const t of PUSH_ORDER) {
    const m = MAPS[t];
    let rows = (await db.table(t).filter((r: Row) => r._dirty === 1).toArray()) as Row[];
    if (t === "tasks") rows = rows.sort((a, b) => Number(!!a.parentId) - Number(!!b.parentId));
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await sb.from(m.server).upsert(chunk.map((r) => toServer(m, r, userId)), { onConflict: "id" });
      if (error) {
        // lote recusado: envia linha a linha e deixa as problemáticas para depois
        for (const r of chunk) {
          const one = await sb.from(m.server).upsert(toServer(m, r, userId), { onConflict: "id" });
          if (!one.error) await clearDirty(t, [r]);
          else console.warn(`sync ${t} ${r.id}:`, one.error.message);
        }
      } else {
        await clearDirty(t, chunk);
      }
    }
    if (t === "blocks") blocks = rows.length;
  }
  return { blocks };
}

/** Limpa a marca só se a linha não mudou de novo durante o envio. */
async function clearDirty(table: SyncedTable, rows: Row[]) {
  await asRemote(() =>
    db.transaction("rw", db.table(table), async () => {
      for (const r of rows) {
        const cur = (await db.table(table).get(r.id ?? "me")) as Row | undefined;
        if (cur && cur.updatedAt === r.updatedAt) await db.table(table).update(r.id ?? "me", { _dirty: 0 });
      }
    }),
  );
}

async function pull(): Promise<boolean> {
  const sb = supabase!;
  const tz = (await getSettings()).timezone;
  const cursors = (await kvGet<Record<string, string>>("sync.cursors")) ?? {};
  let eventsChanged = false;

  // configurações
  {
    let q = sb.from("profiles").select("app_settings, updated_at");
    if (cursors.settings) q = q.gt("updated_at", cursors.settings);
    const { data } = await q.maybeSingle();
    if (data?.app_settings) {
      const local = (await db.settings.get("me")) as (Settings & { _dirty?: number }) | undefined;
      if (!local?._dirty) await asRemote(() => db.settings.put({ ...normalizeSettings(data.app_settings), id: "me" }));
      cursors.settings = data.updated_at;
    }
  }

  for (const t of PUSH_ORDER) {
    const m = MAPS[t];
    let from = 0;
    for (;;) {
      let q = sb.from(m.server).select("*").order("updated_at", { ascending: true }).range(from, from + 499);
      if (cursors[t]) q = q.gte("updated_at", cursors[t]);
      const { data, error } = await q;
      if (error) throw new Error(`${t}: ${error.message}`);
      if (!data?.length) break;
      await asRemote(() =>
        db.transaction("rw", db.table(t), async () => {
          for (const row of data as Record<string, unknown>[]) {
            const id = row.id as string;
            const local = (await db.table(t).get(id)) as Row | undefined;
            if (row.deleted_at) {
              if (local) await db.table(t).delete(id);
            } else if (!local?._dirty || (local.updatedAt ?? "") < (row.updated_at as string)) {
              await db.table(t).put({ ...(local ?? {}), ...fromServer(m, row, tz), _dirty: 0 });
            } else continue;
            if (t === "events") eventsChanged = true;
          }
        }),
      );
      cursors[t] = (data[data.length - 1] as { updated_at: string }).updated_at;
      if (data.length < 500) break;
      from += 500;
    }
  }
  await kvSet("sync.cursors", cursors);
  return eventsChanged;
}

/** Compromissos novos do Google que caem em cima de tarefas confirmadas: re-encaixa. */
async function afterEventsChanged() {
  const { reschedule } = await import("./planner");
  const now = Date.now();
  const events = (await db.events.toArray()).filter((e) => e.blocksTime && !e.allDay && Date.parse(e.end) > now);
  const blocks = (await db.blocks.where("status").equals("confirmado").toArray()).filter((b) => Date.parse(b.start) > now && !b.locked);
  const hit: Block[] = blocks.filter((b) => events.some((e) => Date.parse(e.start) < Date.parse(b.end) && Date.parse(e.end) > Date.parse(b.start)));
  if (hit.length) await reschedule(hit, "gcal");
}

/** Sincronização automática: ao abrir, ao voltar para o app e a cada 30 s com mudanças. */
export function startAutoSync(): () => void {
  if (!supabase) return () => undefined;
  const tick = () => document.visibilityState === "visible" && syncNow();
  const onVis = () => tick();
  document.addEventListener("visibilitychange", onVis);
  const timer = setInterval(async () => {
    const dirty = readTombstones().length || (await Promise.all(SYNCED_TABLES.map((t) => db.table(t).filter((r: Row) => r._dirty === 1).count()))).some((n) => n > 0);
    if (dirty) tick();
  }, 30000);
  const fullTimer = setInterval(tick, 5 * 60000);
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "INITIAL_SESSION") syncNow();
  });
  return () => {
    document.removeEventListener("visibilitychange", onVis);
    clearInterval(timer);
    clearInterval(fullTimer);
    data.subscription.unsubscribe();
  };
}

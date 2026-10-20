// Integração com o app Android (Capacitor). No navegador, tudo aqui é inerte.
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { liveQuery } from "dexie";
import { messagesBetween, type AppSettings } from "@shared/push/messages.ts";
import { db } from "../data/db";
import { checkin, type CheckinResponse } from "../data/planner";
import { getSettings } from "../data/routine";
import { navigate } from "./router";

export const isNative = () => Capacitor.isNativePlatform();

export interface NativeStatus {
  notifications: string; // granted | denied | prompt
  exactAlarms: boolean;
  fullScreen: boolean;
  batteryUnrestricted: boolean;
  manufacturer: string;
  model: string;
  sdk: number;
}

interface NativeItem {
  blockId: string;
  kind: string;
  at: number;
  title: string;
  body: string;
  alarm: boolean;
  silent: boolean;
}

interface AgendaNativePlugin {
  schedule(o: { items: NativeItem[] }): Promise<{ scheduled: number; exact: boolean }>;
  getPendingActions(): Promise<{ actions: { blockId: string; action: string; at: number }[] }>;
  consumeLaunch(): Promise<{ route?: string | null; action?: string | null; blockId?: string | null }>;
  clearNotification(): Promise<void>;
  status(): Promise<NativeStatus>;
  requestNotifications(): Promise<{ notifications: string }>;
  openExactAlarmSettings(): Promise<void>;
  openFullScreenSettings(): Promise<void>;
  requestIgnoreBattery(): Promise<void>;
  openBatterySettings(): Promise<void>;
  openAppSettings(): Promise<void>;
  openNotificationSettings(): Promise<void>;
  testNotification(o: { alarm: boolean; seconds?: number }): Promise<void>;
  listen(): Promise<{ text: string }>;
  addListener(event: "actionsChanged" | "launch", fn: () => void): Promise<{ remove: () => Promise<void> }>;
}

export const AgendaNative = registerPlugin<AgendaNativePlugin>("AgendaNative");

const DAYS = 7;

/** Recalcula e agenda no aparelho os avisos dos próximos 7 dias. */
export async function rescheduleNative(): Promise<number> {
  if (!isNative()) return 0;
  const settings = await getSettings();
  const now = Date.now();
  const blocks = (await db.blocks.where("status").anyOf(["confirmado", "em_andamento"]).toArray()).filter((b) => Date.parse(b.end) > now);
  const taskIds = new Set(blocks.map((b) => b.taskId));
  const all = await db.tasks.toArray();
  const parents = new Set(all.filter((t) => taskIds.has(t.id) && t.parentId).map((t) => t.parentId!));
  const tasks = new Map(
    all.filter((t) => taskIds.has(t.id) || parents.has(t.id)).map((t) => [t.id, { id: t.id, title: t.title, alert_mode: t.alertMode, parent_id: t.parentId }]),
  );
  const rows = blocks.map((b) => ({ id: b.id, task_id: b.taskId, start_at: b.start, end_at: b.end, region: b.region, window_kind: b.windowKind }));
  const msgs = messagesBetween(now, now + DAYS * 86400000, rows, tasks, settings as unknown as AppSettings, "");
  const items: NativeItem[] = msgs.map((m) => ({
    blockId: m.blockId,
    kind: m.kind,
    at: Date.parse(m.fireAt),
    title: m.title,
    body: m.body,
    alarm: m.alarm,
    silent: m.silent,
  }));
  const r = await AgendaNative.schedule({ items });
  return r.scheduled;
}

/** Respostas dadas pela notificação ("Terminei" sem abrir o app). */
async function applyPendingActions() {
  const { actions } = await AgendaNative.getPendingActions();
  for (const a of actions) {
    const b = await db.blocks.get(a.blockId);
    if (!b || b.status === "concluido" || b.status === "remarcado") continue;
    await checkin(a.blockId, a.action as CheckinResponse);
  }
}

/** App aberto por uma notificação: vai para o check-in (e aplica o botão tocado). */
async function handleLaunch() {
  const l = await AgendaNative.consumeLaunch();
  if (!l.route) return;
  if (l.action && l.blockId) navigate(`checkin/${l.blockId}/${l.action}`);
  else navigate(l.route);
}

const SCHEME = "com.opradopedro.agenda://login-callback";

/** Login com Google no app: abre o navegador do sistema e volta pelo esquema do app. */
export async function nativeOAuth(url: string) {
  await Browser.open({ url, windowName: "_self" });
}

let started = false;
export function startNative(exchangeCode: (code: string) => Promise<void>): void {
  if (!isNative() || started) return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => rescheduleNative().catch((e) => console.warn("agendar avisos:", e)), 800);
  };
  // reagenda quando tarefas, horários ou configurações mudam
  liveQuery(async () => {
    const [b, t, s] = await Promise.all([db.blocks.toArray(), db.tasks.count(), db.settings.get("me")]);
    return `${b.map((x) => `${x.id}${x.status}${x.start}${x.end}`).join()}|${t}|${JSON.stringify(s)}`;
  }).subscribe({ next: schedule });

  applyPendingActions().catch(() => undefined);
  handleLaunch().catch(() => undefined);
  AgendaNative.addListener("actionsChanged", () => applyPendingActions().catch(() => undefined));
  AgendaNative.addListener("launch", () => handleLaunch().catch(() => undefined));
  CapApp.addListener("resume", () => {
    applyPendingActions().catch(() => undefined);
    schedule();
  });
  CapApp.addListener("appUrlOpen", async ({ url }) => {
    if (!url.startsWith(SCHEME)) return;
    const code = new URL(url).searchParams.get("code");
    if (code) await exchangeCode(code);
    await Browser.close().catch(() => undefined);
  });
}

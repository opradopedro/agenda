// Web Push no computador: inscreve este navegador e guarda em public.devices.
import { supabase } from "./supabase";
import { callFunction } from "./api";

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && !!VAPID;

function urlB64ToUint8Array(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error("Este navegador não aceita notificações push.");
  if (!supabase) throw new Error("Nuvem não configurada.");
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Entre com sua conta Google primeiro.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Permissão de notificação negada no navegador.");
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(VAPID!) as BufferSource }));
  const json = sub.toJSON();
  const row = {
    user_id: data.session.user.id,
    platform: "web",
    label: navigator.userAgent.slice(0, 120),
    notifications_enabled: true,
    push_endpoint: json.endpoint,
    push_p256dh: json.keys?.p256dh,
    push_auth: json.keys?.auth,
    deleted_at: null,
    last_seen_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("devices").upsert(row, { onConflict: "push_endpoint" });
  if (error) throw new Error(error.message);
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase?.from("devices").update({ notifications_enabled: false, deleted_at: new Date().toISOString() }).eq("push_endpoint", sub.endpoint);
  await sub.unsubscribe();
}

export const sendTestPush = () => callFunction<{ devices: number; sent: number }>("push-dispatch", { test: true });

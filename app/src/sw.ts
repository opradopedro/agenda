/// <reference lib="webworker" />
// Service worker: cache do app (offline), Web Push e botões das notificações.
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { clientsClaim } from "workbox-core";

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

interface PushMessage {
  title: string;
  body: string;
  tag: string;
  blockId?: string;
  kind: string;
  url: string;
  silent: boolean;
  requireInteraction: boolean;
  actions: { action: string; title: string }[];
}

self.addEventListener("push", (event) => {
  let msg: PushMessage;
  try {
    msg = event.data?.json() as PushMessage;
  } catch {
    return;
  }
  const scope = self.registration.scope;
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag, // uma notificação por vez: a nova substitui a anterior
      renotify: true,
      silent: msg.silent,
      requireInteraction: msg.requireInteraction,
      icon: `${scope}icon-192.png`,
      badge: `${scope}icon-192.png`,
      data: { url: msg.url, blockId: msg.blockId },
      actions: msg.actions,
    } as NotificationOptions),
  );
});

self.addEventListener("notificationclick", (event) => {
  const n = event.notification;
  const { url, blockId } = (n.data ?? {}) as { url?: string; blockId?: string };
  n.close();
  const action = event.action; // "terminei" | "mais_tempo" | "" (toque na notificação)
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // app aberto: aplica sem trocar de tela
      if (blockId && action && wins.length) {
        wins[0].postMessage({ type: "checkin", blockId, response: action });
        return;
      }
      const target = blockId ? `${self.registration.scope}#/checkin/${blockId}${action ? `/${action}` : ""}` : url ?? self.registration.scope;
      if (wins.length) {
        await (wins[0] as WindowClient).navigate(target).catch(() => undefined);
        await (wins[0] as WindowClient).focus();
      } else {
        await self.clients.openWindow(target);
      }
    })(),
  );
});

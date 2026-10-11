/// <reference lib="webworker" />
// Service worker: cache do app (offline). Na Fase 2 recebe Web Push e trata
// os botões das notificações.
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { clientsClaim } from "workbox-core";

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

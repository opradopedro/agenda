import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./data/db";
import { normalizeSettings } from "./data/defaults";
import { CaptureBar } from "./components/CaptureBar";
import { IconGear, IconInbox, IconToday, IconWeek } from "./components/Icons";
import { ToastHost } from "./components/Toast";
import { Checkin } from "./features/Checkin";
import { Cooking } from "./features/Cooking";
import { Routines } from "./features/Routines";
import { AndroidSetup } from "./features/AndroidSetup";
import { generateRoutineTasks } from "./data/routines";
import { startAutoSync } from "./data/sync";
import { startNative } from "./lib/native";
import { exchangeCode } from "./lib/supabase";
import { checkin, type CheckinResponse } from "./data/planner";
import { toast } from "./components/Toast";
import { Inbox } from "./features/Inbox";
import { Onboarding } from "./features/Onboarding";
import { Proposal } from "./features/Proposal";
import { Settings } from "./features/Settings";
import { Today } from "./features/Today";
import { Week } from "./features/Week";
import { setTimezone } from "./lib/format";
import { navigate, useRoute } from "./lib/router";

const TABS = [
  { id: "hoje", label: "Hoje", Icon: IconToday },
  { id: "semana", label: "Semana", Icon: IconWeek },
  { id: "caixa", label: "Caixa", Icon: IconInbox },
  { id: "config", label: "Config", Icon: IconGear },
] as const;

export function App() {
  const settings = useLiveQuery(async () => normalizeSettings(await db.settings.get("me")), []);
  const inboxCount = useLiveQuery(async () => {
    const captures = await db.captures.where("status").equals("erro").count();
    const suggestions = await db.tasks.where("status").equals("inbox").filter((t) => !t.parentId).count();
    return captures + suggestions;
  }, []);
  const route = useRoute();
  const [page, arg] = route;

  useEffect(() => {
    if (settings) setTimezone(settings.timezone);
  }, [settings]);

  const ready = !!settings?.onboardingDone;
  // nuvem: sincroniza ao abrir, ao voltar para o app e quando houver mudanças
  // (também antes do onboarding: quem já usa o app em outro aparelho entra e recebe a rotina)
  useEffect(() => startAutoSync(), []);
  // Android: avisos no aparelho, botões da notificação e retorno do login
  useEffect(() => startNative(exchangeCode), []);

  // botões da notificação com o app aberto (o service worker manda a resposta)
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const on = async (ev: MessageEvent) => {
      const d = ev.data as { type?: string; blockId?: string; response?: string };
      if (d?.type !== "checkin" || !d.blockId) return;
      const out = await checkin(d.blockId, d.response as CheckinResponse);
      toast(out.message);
      if (out.planId) navigate(`proposta/${out.planId}`);
    };
    navigator.serviceWorker.addEventListener("message", on);
    return () => navigator.serviceWorker.removeEventListener("message", on);
  }, []);

  // rotinas: gera as ocorrências que entraram no horizonte (ao abrir e ao voltar para o app)
  useEffect(() => {
    if (!ready) return;
    const run = () => generateRoutineTasks().catch(() => undefined);
    run();
    const onVis = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [ready]);

  if (!settings) return null;
  if (!settings.onboardingDone) return <><Onboarding settings={settings} onDone={() => navigate("hoje")} /><ToastHost /></>;
  if (page === "rotina") return <><Onboarding settings={settings} editing onDone={() => navigate("config")} /><ToastHost /></>;
  if (page === "proposta" && arg) return <><Proposal planId={arg} /><ToastHost /></>;
  if (page === "checkin" && arg) return <><Checkin blockId={arg} autoResponse={route[2]} /><ToastHost /></>;
  if (page === "cozinha" && arg) return <><Cooking taskId={arg} /><ToastHost /></>;
  if (page === "rotinas") return <><Routines editId={arg} /><ToastHost /></>;
  if (page === "android") return <><AndroidSetup /><ToastHost /></>;

  const tab = TABS.some((t) => t.id === page) ? page : "hoje";
  return (
    <>
      <main className={`app ${tab === "semana" ? "wide" : ""} ${tab === "config" ? "no-capture" : ""}`}>
        {tab === "hoje" && <Today />}
        {tab === "semana" && <Week />}
        {tab === "caixa" && <Inbox />}
        {tab === "config" && <Settings />}
      </main>
      {tab !== "config" && <CaptureBar />}
      <nav className="tabs">
        {TABS.map(({ id, label, Icon }) => (
          <a key={id} href={`#/${id}`} className={tab === id ? "on" : ""} aria-current={tab === id ? "page" : undefined}>
            <Icon />
            {label}
            {id === "caixa" && !!inboxCount && <span className="badge">{inboxCount}</span>}
          </a>
        ))}
      </nav>
      <ToastHost />
    </>
  );
}

import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./data/db";
import { DEFAULT_SETTINGS } from "./data/defaults";
import { CaptureBar } from "./components/CaptureBar";
import { IconGear, IconInbox, IconToday, IconWeek } from "./components/Icons";
import { ToastHost } from "./components/Toast";
import { Checkin } from "./features/Checkin";
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
  const settings = useLiveQuery(async () => ({ ...DEFAULT_SETTINGS, ...(await db.settings.get("me")) }), []);
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

  if (!settings) return null;
  if (!settings.onboardingDone) return <><Onboarding settings={settings} onDone={() => navigate("hoje")} /><ToastHost /></>;
  if (page === "rotina") return <><Onboarding settings={settings} editing onDone={() => navigate("config")} /><ToastHost /></>;
  if (page === "proposta" && arg) return <><Proposal planId={arg} /><ToastHost /></>;
  if (page === "checkin" && arg) return <><Checkin blockId={arg} /><ToastHost /></>;

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

import type { RoutineDraft, Settings, TimeRange, WakeSleep } from "./types";

const each = <T,>(v: T): Record<number, T> => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { ...v }]));

export const DEFAULT_ROUTINE: RoutineDraft = {
  places: {
    casa: { name: "Casa", region: "Praia Grande" },
    trabalho: { name: "Escritório", region: "Santos" },
    terminal: { name: "Terminal", region: "Santos" },
    faculdade: { name: "Faculdade", region: "Santos" },
  },
  sleep: { sameTime: true, wake: "07:00", sleep: "00:00", days: each<WakeSleep>({ wake: "07:00", sleep: "00:00" }) },
  internship: {
    enabled: true,
    sameTime: true,
    start: "09:00",
    end: "16:00",
    days: { 0: null, 1: "trabalho", 2: "trabalho", 3: "casa", 4: "trabalho", 5: "trabalho", 6: null },
    times: each<TimeRange>({ start: "09:00", end: "16:00" }),
  },
  college: {
    enabled: true,
    sameTime: true,
    start: "19:00",
    end: "23:00",
    days: [1, 2, 3, 4],
    times: each<TimeRange>({ start: "19:00", end: "23:00" }),
  },
  travel: {
    "casa>trabalho": 60,
    "trabalho>casa": 60,
    "casa>terminal": 60,
    "terminal>casa": 60,
    "trabalho>faculdade": 15,
    "terminal>faculdade": 15,
    "faculdade>casa": 40,
    "casa>faculdade": 40,
  },
};

export const DEFAULT_SETTINGS: Settings = {
  id: "me",
  onboardingDone: false,
  timezone: "America/Sao_Paulo",
  wakeTime: "08:00",
  sleepTime: "00:00",
  homeOfficeWeekday: 3,
  terminalWeekday: null,
  scheduleMode: "proposta",
  defaultAlertMode: "lembrete",
  quietStart: null,
  quietEnd: null,
  silentMode: false,
  notifyStart: true,
  notifyEnd: true,
  notifyProposal: true,
  reminderLeadMin: 0,
  moreTimeDefaultMin: 15,
  slotGranularityMin: 15,
  taskBufferMin: 10,
  returnHomeInGaps: false,
  goHomeMinStayMin: 120,
  errandFromHomeOverheadMin: 30,
  lateHour: "22:00",
  horizonDays: 14,
  routine: DEFAULT_ROUTINE,
};

/** Completa configurações salvas por versões anteriores do app. */
export function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  const r = (raw?.routine ?? {}) as Partial<RoutineDraft>;
  const d = structuredClone(DEFAULT_ROUTINE);
  const legacy = raw?.routine && !r.sleep; // antes de existir horário por dia
  s.routine = {
    ...d,
    ...r,
    places: { ...d.places, ...r.places },
    sleep: legacy
      ? { ...d.sleep, wake: raw!.wakeTime ?? d.sleep.wake, sleep: raw!.sleepTime ?? d.sleep.sleep, days: each({ wake: raw!.wakeTime ?? "07:00", sleep: raw!.sleepTime ?? "00:00" }) }
      : { ...d.sleep, ...r.sleep, days: { ...d.sleep.days, ...r.sleep?.days } },
    internship: { ...d.internship, ...r.internship, days: { ...d.internship.days, ...r.internship?.days }, times: { ...d.internship.times, ...r.internship?.times } },
    college: { ...d.college, ...r.college, times: { ...d.college.times, ...r.college?.times } },
    travel: { ...d.travel, ...r.travel },
  };
  if (legacy) {
    // o silêncio era copiado do horário de dormir; agora segue cada dia
    if (raw?.quietStart === raw?.sleepTime) s.quietStart = null;
    s.wakeTime = DEFAULT_SETTINGS.wakeTime;
    s.sleepTime = DEFAULT_SETTINGS.sleepTime;
  }
  return s;
}

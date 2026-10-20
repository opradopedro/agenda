// Regras das notificações (puras, testáveis): quando avisar e com que texto.
import { awakeBounds } from "../scheduler/timeline.ts";
import { addDays, minToLocal, pad } from "../scheduler/time.ts";
import type { DayTimes, ScheduleInput } from "../scheduler/types.ts";

export interface BlockRow {
  id: string;
  task_id: string;
  start_at: string;
  end_at: string;
  region: string | null;
  window_kind: string | null;
}
export interface TaskRow {
  id: string;
  title: string;
  alert_mode: string | null;
  parent_id: string | null;
}

export type AppSettings = Record<string, unknown> & {
  timezone?: string;
  wakeTime?: string;
  sleepTime?: string;
  quietStart?: string | null;
  quietEnd?: string | null;
  silentMode?: boolean;
  notifyStart?: boolean;
  notifyEnd?: boolean;
  reminderLeadMin?: number;
  moreTimeDefaultMin?: number;
  defaultAlertMode?: string;
  routine?: { sleep?: { sameTime?: boolean; wake?: string | null; sleep?: string | null; days?: Record<string, DayTimes> } };
};

export interface PushMessage {
  title: string;
  body: string;
  tag: string;
  blockId?: string;
  kind: "inicio" | "fim" | "teste";
  url: string;
  silent: boolean;
  requireInteraction: boolean;
  actions: { action: string; title: string }[];
}

/** Configurações mínimas que o cálculo do silêncio usa. */
function schedulerSettings(s: AppSettings): ScheduleInput["settings"] {
  const sl = s.routine?.sleep;
  const dayTimes: Record<number, DayTimes> = {};
  for (let wd = 0; wd < 7; wd++) {
    dayTimes[wd] = sl?.sameTime === false ? sl.days?.[wd] ?? { wake: null, sleep: null } : { wake: sl?.wake ?? null, sleep: sl?.sleep ?? null };
  }
  return {
    timezone: s.timezone ?? "America/Sao_Paulo",
    wakeTime: s.wakeTime ?? "08:00",
    sleepTime: s.sleepTime ?? "00:00",
    dayTimes,
    quietStart: s.quietStart ?? null,
    quietEnd: s.quietEnd ?? null,
    slotGranularityMin: 15,
    taskBufferMin: 0,
    returnHomeInGaps: false,
    goHomeMinStayMin: 0,
    errandFromHomeOverheadMin: 0,
    lateHour: "22:00",
  };
}

/** Está acordado (fora do silêncio) nesse instante? */
export function awakeAt(ms: number, s: AppSettings): boolean {
  const settings = schedulerSettings(s);
  const input = { settings } as ScheduleInput;
  const t = Math.floor(ms / 60000);
  const today = minToLocal(t, settings.timezone).date;
  for (const d of [today, addDays(today, -1)]) {
    const [a, b] = awakeBounds(d, input);
    if (t >= a && t < b) return true;
  }
  return false;
}

const hm = (iso: string, tz: string) => {
  const l = minToLocal(Math.floor(Date.parse(iso) / 60000), tz);
  return `${pad(Math.floor(l.minutes / 60))}:${pad(l.minutes % 60)}`;
};

/** Notificações devidas agora (janela de ~1,5 min, o cron roda a cada minuto). */
export function dueMessages(nowMs: number, blocks: BlockRow[], tasks: Map<string, TaskRow>, s: AppSettings, base: string): (PushMessage & { blockId: string; fireAt: string })[] {
  const tz = s.timezone ?? "America/Sao_Paulo";
  const lead = Number(s.reminderLeadMin ?? 0) * 60000;
  const more = Number(s.moreTimeDefaultMin ?? 15);
  const out: (PushMessage & { blockId: string; fireAt: string })[] = [];
  for (const b of blocks) {
    const task = tasks.get(b.task_id);
    const parent = task?.parent_id ? tasks.get(task.parent_id) : undefined;
    const alert = task?.alert_mode ?? s.defaultAlertMode ?? "lembrete";
    if (alert === "nenhum") continue;
    const title = task?.title ?? "Tarefa";
    const where = b.window_kind === "fora" && b.region ? ` · em ${b.region}` : "";
    const candidates: [("inicio" | "fim"), number][] = [];
    if (s.notifyStart !== false) candidates.push(["inicio", Date.parse(b.start_at) - lead]);
    if (s.notifyEnd !== false) candidates.push(["fim", Date.parse(b.end_at)]);
    for (const [kind, at] of candidates) {
      if (at > nowMs + 15000 || at <= nowMs - 75000) continue;
      if (!awakeAt(at, s)) continue;
      const alarm = alert === "alarme";
      out.push(
        kind === "inicio"
          ? {
            blockId: b.id,
            fireAt: new Date(at).toISOString(),
            kind,
            tag: "agenda",
            title: lead ? `Daqui a pouco: ${title}` : `Agora: ${title}`,
            body: `${hm(b.start_at, tz)}–${hm(b.end_at, tz)}${where}${parent ? ` · ${parent.title}` : ""}`,
            url: `${base}#/checkin/${b.id}`,
            silent: !!s.silentMode && !alarm,
            requireInteraction: alarm,
            actions: [],
          }
          : {
            blockId: b.id,
            fireAt: new Date(at).toISOString(),
            kind,
            tag: "agenda",
            title: `Terminou? ${title}`,
            body: "Toque para o check-in: terminei, mais tempo ou remarcar.",
            url: `${base}#/checkin/${b.id}`,
            silent: !!s.silentMode && !alarm,
            requireInteraction: true,
            actions: [{ action: "terminei", title: "Terminei" }, { action: "mais_tempo", title: `+${more} min` }],
          },
      );
    }
  }
  return out;
}


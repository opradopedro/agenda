import { fmtDur, minToLocal } from "@shared/scheduler/index.ts";

let TZ = "America/Sao_Paulo";
export const setTimezone = (tz: string) => (TZ = tz);
export const tz = () => TZ;

const timeFmt = () => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dayFmt = () => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const longDayFmt = () => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });

export const fmtTime = (iso: string) => timeFmt().format(new Date(iso));
export const fmtRange = (a: string, b: string) => `${fmtTime(a)}–${fmtTime(b)}`;
export { fmtDur };

/** "2026-10-14" local de um ISO. */
export const localDate = (iso: string | number | Date) =>
  minToLocal(Math.floor(new Date(iso).getTime() / 60000), TZ).date;

export const todayLocal = () => localDate(Date.now());

export function addDaysLocal(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const noonUtc = (date: string) => new Date(`${date}T15:00:00Z`);

export function fmtDayLabel(date: string, long = false): string {
  const t = todayLocal();
  if (date === t) return "Hoje";
  if (date === addDaysLocal(t, 1)) return "Amanhã";
  if (date === addDaysLocal(t, -1)) return "Ontem";
  const s = (long ? longDayFmt() : dayFmt()).format(noonUtc(date)).replace(/\./g, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const fmtDayShort = (date: string) => dayFmt().format(noonUtc(date)).replace(/\./g, "");

export function fmtWhen(iso: string): string {
  return `${fmtDayLabel(localDate(iso))} · ${fmtTime(iso)}`;
}

export const CATEGORY_LABEL: Record<string, string> = {
  pessoal: "Pessoal",
  faculdade: "Faculdade",
  tcc: "TCC",
  empresa_junior: "Empresa Jr.",
  trabalho: "Trabalho",
};

export const LOCATION_LABEL: Record<string, string> = { casa: "Em casa", rua: "Na rua", qualquer: "Qualquer lugar" };
export const PRIORITY_LABEL = ["", "Baixa", "Normal", "Alta", "Urgente"];
export const ALERT_LABEL: Record<string, string> = { lembrete: "Lembrete", alarme: "Alarme", nenhum: "Sem aviso" };

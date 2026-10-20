// Recorrência semanal simples no formato RFC 5545:
//   FREQ=WEEKLY;BYDAY=WE,FR[;INTERVAL=2]
import { addDays, weekdayOf } from "./time.ts";

const CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export interface WeeklyRule {
  weekdays: number[]; // 0 = domingo
  interval: number; // a cada N semanas
}

export function parseRrule(rrule: string): WeeklyRule {
  const parts = Object.fromEntries(
    rrule.split(";").map((p) => p.split("=") as [string, string]).filter(([k, v]) => k && v).map(([k, v]) => [k.toUpperCase(), v.toUpperCase()]),
  );
  const weekdays = (parts.BYDAY ?? "")
    .split(",")
    .map((c: string) => CODES.indexOf(c.trim().slice(-2)))
    .filter((d: number) => d >= 0);
  return { weekdays: [...new Set(weekdays)].sort(), interval: Math.max(1, Number(parts.INTERVAL) || 1) };
}

export function toRrule(rule: WeeklyRule): string {
  const by = [...new Set(rule.weekdays)].sort().map((d) => CODES[d]).join(",");
  return `FREQ=WEEKLY;BYDAY=${by}${rule.interval > 1 ? `;INTERVAL=${rule.interval}` : ""}`;
}

/** Domingo da semana de uma data (as semanas da regra começam no domingo). */
function weekStart(date: string): string {
  return addDays(date, -weekdayOf(date));
}

/** Datas (YYYY-MM-DD) entre `from` e `to` (inclusive) em que a regra acontece. */
export function occurrences(rrule: string, startDate: string, from: string, to: string): string[] {
  const rule = parseRrule(rrule);
  if (!rule.weekdays.length) return [];
  const base = weekStart(startDate);
  const out: string[] = [];
  for (let d = from < startDate ? startDate : from; d <= to; d = addDays(d, 1)) {
    if (!rule.weekdays.includes(weekdayOf(d))) continue;
    const weeks = Math.round((Date.parse(weekStart(d)) - Date.parse(base)) / (7 * 86400000));
    if (weeks % rule.interval === 0) out.push(d);
  }
  return out;
}

const NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "toda quarta", "toda segunda e quinta", "a cada 2 semanas, na sexta" */
export function describeRrule(rrule: string): string {
  const r = parseRrule(rrule);
  if (!r.weekdays.length) return "sem dias";
  const days = r.weekdays.map((d) => NAMES[d]);
  const list = days.length === 1 ? days[0] : `${days.slice(0, -1).join(", ")} e ${days[days.length - 1]}`;
  if (r.weekdays.length === 7) return r.interval > 1 ? `todos os dias, a cada ${r.interval} semanas` : "todos os dias";
  const toda = r.weekdays.every((d) => d === 0 || d === 6) ? "todo" : "toda";
  return r.interval > 1 ? `a cada ${r.interval} semanas: ${list}` : `${days.length === 1 && (r.weekdays[0] === 0 || r.weekdays[0] === 6) ? "todo" : toda} ${list}`;
}

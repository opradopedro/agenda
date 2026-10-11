// Conversões entre horário local (fuso do usuário) e instantes.
// Internamente o agendador trabalha em "minutos desde a época" (inteiros).

export type Min = number;

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
}

function partsAt(ms: number, tz: string): Parts {
  const p: Record<string, number> = {};
  for (const part of dtf(tz).formatToParts(new Date(ms))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute };
}

/** Diferença (em minutos) entre o horário local e o UTC naquele instante. */
export function offsetMin(ms: number, tz: string): number {
  const p = partsAt(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 60000);
}

/** "2026-10-14" + 960 (16:00) no fuso → minutos desde a época. */
export function localToMin(date: string, minutesOfDay: number, tz: string): Min {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minutesOfDay);
  let ms = naive - offsetMin(naive, tz) * 60000;
  ms = naive - offsetMin(ms, tz) * 60000;
  return Math.round(ms / 60000);
}

export interface LocalInfo {
  date: string;
  minutes: number;
  weekday: number;
}

export function minToLocal(t: Min, tz: string): LocalInfo {
  const p = partsAt(t * 60000, tz);
  const date = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  return { date, minutes: p.h * 60 + p.min, weekday: weekdayOf(date) };
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function hhmmToMin(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function isoToMin(iso: string): Min {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`data inválida: ${iso}`);
  return Math.floor(ms / 60000);
}

/** Instante → ISO com o deslocamento do fuso, ex.: 2026-10-14T16:00:00-03:00 */
export function minToIso(t: Min, tz: string): string {
  const off = offsetMin(t * 60000, tz);
  const l = minToLocal(t, tz);
  const sign = off < 0 ? "-" : "+";
  const a = Math.abs(off);
  return `${l.date}T${pad(Math.floor(l.minutes / 60))}:${pad(l.minutes % 60)}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

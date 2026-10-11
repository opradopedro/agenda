// Passo 1: linha do tempo de lugares de um dia → janelas livres.
import {
  hhmmToMin,
  isoToMin,
  localToMin,
  Min,
  minToIso,
  minToLocal,
  weekdayOf,
} from "./time.ts";
import type {
  BusyBlock,
  ScheduleInput,
  TimelineSegment,
  WindowKind,
} from "./types.ts";

export interface Window {
  start: Min;
  end: Min;
  kind: WindowKind;
  region: string | null;
  placeId: string | null;
  date: string;
  /** Janelas do fim do dia depois de um compromisso fora: a parte "fora"
   *  e a parte "casa" disputam o mesmo tempo (ver TailState). */
  tail?: TailState;
}

/** Depois do último compromisso fora de casa, dá para emendar tarefas na
 *  região antes de voltar. Tudo que entra na parte "fora" atrasa a chegada. */
export interface TailState {
  from: Min;
  travelHome: number;
  /** fim da última tarefa feita fora (ou `from`) */
  lastForaEnd: Min;
  /** início da primeira tarefa feita em casa (ou fim do dia) */
  firstCasaStart: Min;
}

interface Anchor {
  start: Min;
  end: Min;
  placeId: string | null;
  title: string;
  sourceId: string;
}

export interface DayPlan {
  date: string;
  awakeStart: Min;
  awakeEnd: Min;
  windows: Window[];
  segments: Seg[];
}

export interface Seg {
  kind: TimelineSegment["kind"];
  start: Min;
  end: Min;
  title: string;
  placeId: string | null;
  windowKind?: WindowKind;
  region?: string | null;
  sourceId?: string;
  tail?: TailState;
}

export class PlaceBook {
  readonly homeId: string | null;
  private region = new Map<string, string | null>();
  private name = new Map<string, string>();
  private travel = new Map<string, number>();

  constructor(input: Pick<ScheduleInput, "places" | "travel">) {
    this.homeId = input.places.find((p) => p.kind === "casa")?.id ?? null;
    for (const p of input.places) {
      this.region.set(p.id, p.region);
      this.name.set(p.id, p.name);
    }
    for (const t of input.travel) {
      this.travel.set(`${t.fromPlaceId}>${t.toPlaceId}`, t.minutes);
    }
  }

  regionOf(id: string | null): string | null {
    return id ? (this.region.get(id) ?? null) : null;
  }

  nameOf(id: string | null): string {
    return id ? (this.name.get(id) ?? "") : "";
  }

  /** Sem a volta cadastrada, usa a ida. Lugares desconhecidos: 0. */
  minutes(from: string | null, to: string | null): number {
    if (!from || !to || from === to) return 0;
    return this.travel.get(`${from}>${to}`) ?? this.travel.get(`${to}>${from}`) ?? 0;
  }

  kindAt(id: string | null): WindowKind {
    return id !== null && id === this.homeId ? "casa" : "fora";
  }
}

function anchorsFor(date: string, input: ScheduleInput, awakeStart: Min, awakeEnd: Min): Anchor[] {
  const tz = input.settings.timezone;
  const wd = weekdayOf(date);
  const out: Anchor[] = [];
  for (const c of input.commitments) {
    if (c.active === false || c.weekday !== wd) continue;
    if (c.validFrom && date < c.validFrom) continue;
    if (c.validUntil && date > c.validUntil) continue;
    out.push({
      start: localToMin(date, hhmmToMin(c.start), tz),
      end: localToMin(date, hhmmToMin(c.end), tz),
      placeId: c.placeId,
      title: c.title,
      sourceId: c.id,
    });
  }
  for (const e of input.events) {
    if (e.allDay || e.blocksTime === false) continue;
    const s = isoToMin(e.start);
    const en = isoToMin(e.end);
    if (en <= awakeStart || s >= awakeEnd) continue;
    out.push({ start: s, end: en, placeId: e.placeId ?? null, title: e.title, sourceId: e.id });
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  // junta sobreposições; o lugar que vale é o do compromisso que termina por último
  const merged: Anchor[] = [];
  for (const a of out) {
    const last = merged[merged.length - 1];
    if (last && a.start < last.end) {
      if (a.end > last.end) {
        last.end = a.end;
        if (a.placeId) last.placeId = a.placeId;
      }
      last.title = `${last.title} + ${a.title}`;
    } else {
      merged.push({ ...a });
    }
  }
  return merged;
}

/** Janela acordado: do horário de acordar até dormir ou o início do silêncio. */
export function awakeBounds(date: string, input: ScheduleInput): [Min, Min] {
  const s = input.settings;
  const tz = s.timezone;
  const wake = hhmmToMin(s.wakeTime);
  const start = localToMin(date, wake, tz);
  const sleep = hhmmToMin(s.sleepTime);
  const end = localToMin(date, sleep > wake ? sleep : sleep + 1440, tz);
  const q = hhmmToMin(s.quietStart);
  const quiet = localToMin(date, q > wake ? q : q + 1440, tz);
  return [start, Math.min(end, quiet)];
}

/**
 * Monta o dia. `blocks` (opcional) são tarefas já agendadas: servem só para
 * desenhar o deslocamento de volta no lugar certo quando houve tarefa "fora"
 * emendada no fim do dia.
 */
export function buildDay(date: string, input: ScheduleInput, blocks: BusyBlock[] = []): DayPlan {
  const book = new PlaceBook(input);
  const home = book.homeId;
  const [awakeStart, awakeEnd] = awakeBounds(date, input);
  const anchors = anchorsFor(date, input, awakeStart, awakeEnd);
  const windows: Window[] = [];
  const segments: Seg[] = [];
  const s = input.settings;

  const pushWindow = (start: Min, end: Min, placeId: string | null, tail?: TailState) => {
    const a = Math.max(start, awakeStart);
    const b = Math.min(end, awakeEnd);
    if (b - a <= 0) return;
    const w: Window = {
      start: a,
      end: b,
      kind: book.kindAt(placeId),
      region: book.regionOf(placeId),
      placeId,
      date,
      tail,
    };
    windows.push(w);
    segments.push({
      kind: "janela",
      start: a,
      end: b,
      title: w.kind === "casa" ? "Livre em casa" : `Livre${w.region ? ` em ${w.region}` : " fora"}`,
      placeId,
      windowKind: w.kind,
      region: w.region,
      tail,
    });
  };
  const pushTravel = (start: Min, end: Min, from: string | null, to: string | null) => {
    if (end <= start) return;
    segments.push({
      kind: "deslocamento",
      start,
      end,
      title: `${book.nameOf(from) || "?"} → ${book.nameOf(to) || "?"}`,
      placeId: to,
    });
  };

  let cur: string | null = home;
  let cursor = awakeStart;
  for (const a of anchors) {
    const dest = a.placeId ?? cur;
    // volta para casa no meio, se permitido e se compensar
    if (s.returnHomeInGaps && cur !== home && dest !== home && home) {
      const t1 = book.minutes(cur, home);
      const t2 = book.minutes(home, dest);
      if (a.start - cursor - t1 - t2 >= s.goHomeMinStayMin) {
        pushTravel(cursor, cursor + t1, cur, home);
        cursor += t1;
        cur = home;
      }
    }
    const tr = book.minutes(cur, dest);
    const depart = a.start - tr;
    if (depart > cursor) pushWindow(cursor, depart, cur);
    pushTravel(Math.max(cursor, depart), a.start, cur, dest);
    segments.push({
      kind: "compromisso",
      start: a.start,
      end: a.end,
      title: a.title,
      placeId: dest,
      windowKind: book.kindAt(dest),
      region: book.regionOf(dest),
      sourceId: a.sourceId,
    });
    cursor = Math.max(cursor, a.end);
    cur = dest;
  }

  if (cur === home || !home) {
    pushWindow(cursor, awakeEnd, cur);
  } else {
    const trH = book.minutes(cur, home);
    const tail: TailState = {
      from: cursor,
      travelHome: trH,
      lastForaEnd: cursor,
      firstCasaStart: awakeEnd,
    };
    for (const b of blocks) {
      const bs = isoToMin(b.start);
      const be = isoToMin(b.end);
      if (bs < cursor || bs >= awakeEnd) continue;
      if (b.windowKind === "fora") tail.lastForaEnd = Math.max(tail.lastForaEnd, be);
      if (b.windowKind === "casa") tail.firstCasaStart = Math.min(tail.firstCasaStart, bs);
    }
    pushWindow(cursor, awakeEnd - trH, cur, tail);
    pushWindow(cursor + trH, awakeEnd, home, tail);
    pushTravel(tail.lastForaEnd, tail.lastForaEnd + trH, cur, home);
  }

  segments.sort((x, y) => x.start - y.start || x.end - y.end);
  return { date, awakeStart, awakeEnd, windows, segments };
}

/** Datas locais do horizonte, começando no dia de `now`. */
export function horizonDates(input: ScheduleInput): string[] {
  const first = minToLocal(isoToMin(input.now), input.settings.timezone).date;
  const out: string[] = [];
  const [y, m, d] = first.split("-").map(Number);
  for (let i = 0; i < input.horizonDays; i++) {
    const t = new Date(Date.UTC(y, m - 1, d + i));
    out.push(t.toISOString().slice(0, 10));
  }
  return out;
}

/** Linha do tempo de um dia para a UI (sem as tarefas). */
export function dayTimeline(date: string, input: ScheduleInput, blocks: BusyBlock[] = []): TimelineSegment[] {
  const tz = input.settings.timezone;
  return buildDay(date, input, blocks).segments.map((sg) => ({
    kind: sg.kind,
    start: minToIso(sg.start, tz),
    end: minToIso(sg.end, tz),
    title: sg.title,
    placeId: sg.placeId,
    windowKind: sg.windowKind,
    region: sg.region,
    sourceId: sg.sourceId,
  }));
}

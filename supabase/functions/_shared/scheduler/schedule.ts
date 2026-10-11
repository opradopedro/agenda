// Passos 2 e 3: compatibilidade local × janela e encaixe por custo.
// Determinístico: mesma entrada → mesma saída. "Agora" vem em input.now.
import { buildDay, horizonDates, PlaceBook, Window } from "./timeline.ts";
import { hhmmToMin, isoToMin, localToMin, Min, minToIso } from "./time.ts";
import type {
  PlannedBlock,
  ScheduleInput,
  ScheduleResult,
  TaskInput,
  Unplaced,
} from "./types.ts";

interface Slot {
  start: Min;
  end: Min;
  pre: number;
  post: number;
  window: Window;
  cost: number;
}

interface Ctx {
  input: ScheduleInput;
  now: Min;
  windows: Window[];
  occupied: Array<[Min, Min]>;
  homeRegion: string | null;
}

const alignUp = (t: Min, g: number) => Math.ceil(t / g) * g;

export function compatible(task: TaskInput, w: Window, homeRegion: string | null): boolean {
  if (task.location === "casa") return w.kind === "casa";
  if (task.location === "rua" && task.region) {
    const wr = w.kind === "casa" ? homeRegion : w.region;
    return norm(wr) === norm(task.region);
  }
  return true;
}

const norm = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

function overlaps(ctx: Ctx, lo: Min, hi: Min): boolean {
  for (const [a, b] of ctx.occupied) if (a < hi && b > lo) return true;
  return false;
}

function findBest(
  ctx: Ctx,
  task: TaskInput,
  dur: number,
  earliest: Min,
  latestEnd: Min | null,
  softDeadline: Min | null,
): Slot | null {
  const s = ctx.input.settings;
  const tz = s.timezone;
  const g = s.slotGranularityMin;
  const buf = s.taskBufferMin;
  let best: Slot | null = null;

  for (const w of ctx.windows) {
    if (!compatible(task, w, ctx.homeRegion)) continue;
    const overhead = task.location === "rua" && w.kind === "casa" ? s.errandFromHomeOverheadMin : 0;
    const pre = Math.floor(overhead / 2);
    const post = overhead - pre;

    let lo = Math.max(w.start + pre, earliest);
    let hi = w.end;
    if (w.tail) {
      if (w.kind === "fora") hi = Math.min(hi, w.tail.firstCasaStart - w.tail.travelHome);
      else lo = Math.max(lo, w.tail.lastForaEnd + w.tail.travelHome + pre);
    }
    const late = localToMin(w.date, hhmmToMin(s.lateHour), tz);

    // grade de `g` minutos + inícios colados no fim de outra tarefa (com intervalo)
    const starts = new Set<number>();
    for (let st = alignUp(lo, g); st + dur + post <= hi; st += g) starts.add(st);
    for (const [, b] of ctx.occupied) {
      const st = b + buf + pre;
      if (st >= lo && st + dur + post <= hi) starts.add(st);
    }
    for (const st of [...starts].sort((a, b) => a - b)) {
      const en = st + dur;
      if (latestEnd !== null && en > latestEnd) break;
      if (overlaps(ctx, st - pre - buf, en + post + buf)) continue;

      const pr = Math.min(4, Math.max(1, task.priority || 2));
      let cost = ((st - ctx.now) / 60) * (0.01 + 0.01 * pr);
      if (en > late) cost += ((en - Math.max(st, late)) / 60) * 3;
      if (softDeadline !== null && en > softDeadline) cost += 40 + (en - softDeadline) / 120;
      if (w.kind === "casa" && task.location !== "casa") cost += 0.4;
      // ficar fora depois do último compromisso atrasa a chegada em casa
      if (w.tail && w.kind === "fora") cost += ((en - w.tail.from) / 60) * 0.5;
      cost += (overhead / 60) * 1.5;
      cost += fragmentation(ctx, w, st - pre, en + post, hi, buf);

      if (!best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) < 1e-9 && st < best.start)) {
        best = { start: st, end: en, pre, post, window: w, cost };
      }
    }
  }
  return best;
}

/** Penaliza sobras inúteis (< 30 min além do intervalo) antes/depois do bloco. */
function fragmentation(ctx: Ctx, w: Window, lo: Min, hi: Min, wEnd: Min, buf: number): number {
  let prev = w.start;
  let next = wEnd;
  for (const [a, b] of ctx.occupied) {
    if (b <= lo && b > prev) prev = b;
    if (a >= hi && a < next) next = a;
  }
  let c = 0;
  const before = lo - prev;
  const after = next - hi;
  if (before > buf && before < buf + 30) c += 0.25;
  if (after > buf && after < buf + 30) c += 0.25;
  return c;
}

function commit(ctx: Ctx, slot: Slot) {
  ctx.occupied.push([slot.start - slot.pre, slot.end + slot.post]);
  const t = slot.window.tail;
  if (t) {
    if (slot.window.kind === "fora") t.lastForaEnd = Math.max(t.lastForaEnd, slot.end + slot.post);
    else t.firstCasaStart = Math.min(t.firstCasaStart, slot.start - slot.pre);
  }
}

function explain(ctx: Ctx, task: TaskInput, hard: boolean): string {
  const compat = ctx.windows.filter((w) => compatible(task, w, ctx.homeRegion));
  const days = ctx.input.horizonDays;
  if (compat.length === 0) {
    if (task.location === "casa") return `Nenhum horário livre em casa nos próximos ${days} dias`;
    if (task.region) return `Nenhum horário livre em ${task.region} nos próximos ${days} dias`;
    return `Nenhum horário livre nos próximos ${days} dias`;
  }
  const longest = Math.max(...compat.map((w) => w.end - w.start));
  if (task.durationMin > longest && !task.splittable) {
    return `Maior que o maior intervalo livre (${fmtDur(longest)}). Divida a tarefa ou marque como divisível`;
  }
  if (hard && task.deadline) return "Não cabe antes do prazo";
  return "Sem horário livre compatível na semana";
}

export function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`) : `${m} min`;
}

export function schedule(input: ScheduleInput): ScheduleResult {
  const s = input.settings;
  const tz = s.timezone;
  const now = alignUp(isoToMin(input.now), s.slotGranularityMin);
  const book = new PlaceBook(input);

  const windows: Window[] = [];
  for (const date of horizonDates(input)) {
    for (const w of buildDay(date, input, input.busy).windows) {
      if (w.end <= now) continue;
      windows.push({ ...w, start: Math.max(w.start, now) });
    }
  }
  windows.sort((a, b) => a.start - b.start || a.end - b.end);

  const ctx: Ctx = {
    input,
    now,
    windows,
    occupied: input.busy.map((b) => [isoToMin(b.start), isoToMin(b.end)] as [Min, Min]),
    homeRegion: book.regionOf(book.homeId),
  };

  // cadeias: tarefa com subtarefas → subtarefas em ordem; tarefa simples → ela mesma
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const children = new Map<string, TaskInput[]>();
  for (const t of input.tasks) {
    if (t.parentId && byId.has(t.parentId)) {
      const arr = children.get(t.parentId) ?? [];
      arr.push(t);
      children.set(t.parentId, arr);
    }
  }
  interface Chain {
    parent: TaskInput | null;
    steps: TaskInput[];
    deadline: Min;
    priority: number;
    total: number;
    key: string;
  }
  const chains: Chain[] = [];
  for (const t of input.tasks) {
    if (t.parentId && byId.has(t.parentId)) continue;
    const kids = (children.get(t.id) ?? []).slice().sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.id.localeCompare(b.id));
    const steps = kids.length ? kids : [t];
    const dls = [t, ...kids].map((x) => (x.deadline ? isoToMin(x.deadline) : Infinity));
    chains.push({
      parent: kids.length ? t : null,
      steps,
      deadline: Math.min(...dls),
      priority: Math.max(t.priority || 2, ...kids.map((k) => k.priority || 2)),
      total: steps.reduce((acc, x) => acc + x.durationMin, 0),
      key: t.id,
    });
  }
  chains.sort(
    (a, b) =>
      a.deadline - b.deadline || b.priority - a.priority || b.total - a.total || a.key.localeCompare(b.key),
  );

  const blocks: PlannedBlock[] = [];
  const unplaced: Unplaced[] = [];

  for (const ch of chains) {
    let prevEnd: Min | null = null;
    let failed = false;
    ch.steps.forEach((step, i) => {
      if (failed) {
        unplaced.push({ taskId: step.id, reason: "A etapa anterior não coube" });
        return;
      }
      const p = ch.parent;
      const dl = step.deadline ?? p?.deadline ?? null;
      const hard = (step.deadline ? step.deadlineHard : p?.deadlineHard ?? step.deadlineHard) !== false;
      const after = ch.steps.slice(i + 1).reduce((acc, x) => acc + x.durationMin, 0);
      const dlMin = dl ? isoToMin(dl) - after : null;
      let earliest = now;
      for (const e of [step.earliestStart, p?.earliestStart]) if (e) earliest = Math.max(earliest, isoToMin(e));
      if (prevEnd !== null) earliest = Math.max(earliest, prevEnd);
      const merged: TaskInput = { ...step, region: step.region ?? (step.location === "rua" ? p?.region : null) };

      const placed = placeTask(ctx, merged, earliest, hard ? dlMin : null, hard ? null : dlMin);
      if (!placed) {
        unplaced.push({ taskId: step.id, reason: explain(ctx, merged, hard && dl !== null) });
        failed = true;
        return;
      }
      for (const sl of placed) {
        blocks.push({
          taskId: step.id,
          start: minToIso(sl.start, tz),
          end: minToIso(sl.end, tz),
          windowKind: sl.window.kind,
          region: sl.window.kind === "casa" ? ctx.homeRegion : sl.window.region,
        });
      }
      prevEnd = placed[placed.length - 1].end;
    });
  }

  blocks.sort((a, b) => a.start.localeCompare(b.start));
  return { blocks, unplaced };
}

function placeTask(ctx: Ctx, task: TaskInput, earliest: Min, latestEnd: Min | null, soft: Min | null): Slot[] | null {
  const whole = findBest(ctx, task, task.durationMin, earliest, latestEnd, soft);
  if (whole) {
    commit(ctx, whole);
    return [whole];
  }
  if (!task.splittable) return null;

  const g = ctx.input.settings.slotGranularityMin;
  const minChunk = Math.max(task.minChunkMin ?? 30, g);
  const snapshot = { occ: ctx.occupied.slice(), tails: ctx.windows.map((w) => (w.tail ? { ...w.tail } : null)) };
  const out: Slot[] = [];
  let remaining = task.durationMin;
  let from = earliest;
  for (let guard = 0; remaining > 0 && guard < 40; guard++) {
    let got: Slot | null = null;
    const maxTry = Math.min(remaining, 240);
    for (let size = maxTry; size >= Math.min(minChunk, remaining); size -= g) {
      const lastChunk = size === remaining;
      if (!lastChunk && remaining - size < minChunk) continue; // não deixa sobra menor que o mínimo
      got = findBest(ctx, task, size, from, latestEnd, soft);
      if (got) break;
    }
    if (!got) {
      ctx.occupied = snapshot.occ;
      ctx.windows.forEach((w, i) => {
        const t = snapshot.tails[i];
        if (w.tail && t) Object.assign(w.tail, t);
      });
      return null;
    }
    commit(ctx, got);
    out.push(got);
    remaining -= got.end - got.start;
    from = got.end;
  }
  return remaining > 0 ? null : out;
}

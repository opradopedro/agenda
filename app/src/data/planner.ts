// Liga o banco local ao agendador: monta a entrada, grava propostas/blocos e
// aplica check-ins (Terminei / Mais tempo / Remarcar) com reparo mínimo.
import { schedule, type ScheduleInput, type TaskInput } from "@shared/scheduler/index.ts";
import { db, newId, nowIso } from "./db";
import { getSettings } from "./routine";
import type { Block, Plan, PlanTrigger, Settings, Task } from "./types";

const ACTIVE: Block["status"][] = ["confirmado", "em_andamento"];
const DONE_TASK: Task["status"][] = ["concluida", "cancelada"];

export function toSchedulerSettings(s: Settings): ScheduleInput["settings"] {
  return {
    timezone: s.timezone,
    wakeTime: s.wakeTime,
    sleepTime: s.sleepTime,
    quietStart: s.quietStart,
    quietEnd: s.quietEnd,
    slotGranularityMin: s.slotGranularityMin,
    taskBufferMin: s.taskBufferMin,
    returnHomeInGaps: s.returnHomeInGaps,
    goHomeMinStayMin: s.goHomeMinStayMin,
    errandFromHomeOverheadMin: s.errandFromHomeOverheadMin,
    lateHour: s.lateHour,
  };
}

/** Entrada do agendador com tudo menos as tarefas (usada também pela UI). */
export async function baseInput(now = nowIso()): Promise<ScheduleInput> {
  const [settings, places, travel, commitments, events, blocks] = await Promise.all([
    getSettings(),
    db.places.toArray(),
    db.travel.toArray(),
    db.commitments.toArray(),
    db.events.toArray(),
    db.blocks.where("status").anyOf(ACTIVE).toArray(),
  ]);
  const nowMs = Date.parse(now);
  return {
    now,
    horizonDays: settings.horizonDays,
    settings: toSchedulerSettings(settings),
    places,
    travel,
    commitments,
    events: events
      .filter((e) => Date.parse(e.end) > nowMs - 86400000)
      .map((e) => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, blocksTime: e.blocksTime, placeId: e.placeId })),
    tasks: [],
    busy: blocks
      .filter((b) => Date.parse(b.end) > nowMs - 86400000)
      .map((b) => ({ id: b.id, taskId: b.taskId, start: b.start, end: b.end, windowKind: b.windowKind })),
  };
}

function taskInput(t: Task, earliest?: string | null): TaskInput {
  return {
    id: t.id,
    parentId: t.parentId,
    seq: t.seq,
    title: t.title,
    durationMin: t.durationMin,
    earliestStart: earliest ?? t.earliestStart,
    deadline: t.deadline,
    deadlineHard: t.deadlineHard,
    priority: t.priority,
    location: t.location,
    region: t.region,
    splittable: t.splittable,
    minChunkMin: t.minChunkMin,
  };
}

/**
 * Monta as entradas de tarefas para `ids`. Pais com subtarefas entram como
 * contêiner com as subtarefas ainda sem horário; subtarefas respeitam a ordem
 * em relação às irmãs que já têm horário.
 */
async function collectInputs(ids: string[]): Promise<TaskInput[]> {
  const all = await db.tasks.toArray();
  const byId = new Map(all.map((t) => [t.id, t]));
  const activeBlocks = await db.blocks.where("status").anyOf([...ACTIVE, "concluido"]).toArray();
  const lastEnd = new Map<string, string>();
  for (const b of activeBlocks) {
    const cur = lastEnd.get(b.taskId);
    if (!cur || b.end > cur) lastEnd.set(b.taskId, b.end);
  }
  const hasActive = new Set(activeBlocks.filter((b) => ACTIVE.includes(b.status)).map((b) => b.taskId));
  const kids = (pid: string) => all.filter((t) => t.parentId === pid).sort((a, b) => a.seq - b.seq);
  const placeable = (t: Task) => !DONE_TASK.includes(t.status) && t.status !== "inbox" && !hasActive.has(t.id);

  const wanted = new Set<string>();
  for (const id of ids) {
    const t = byId.get(id);
    if (!t) continue;
    const root = t.parentId ? byId.get(t.parentId) : t;
    if (!root) continue;
    const children = kids(root.id);
    if (children.length === 0) {
      if (placeable(root)) wanted.add(root.id);
    } else {
      for (const c of children) if (placeable(c) && (c.id === id || root.id === id || wanted.has(c.id) || c.seq > t.seq)) wanted.add(c.id);
    }
  }

  const out: TaskInput[] = [];
  const parentsAdded = new Set<string>();
  for (const id of wanted) {
    const t = byId.get(id)!;
    let earliest = t.earliestStart;
    if (t.parentId) {
      const p = byId.get(t.parentId)!;
      if (!parentsAdded.has(p.id)) {
        out.push(taskInput(p));
        parentsAdded.add(p.id);
      }
      // não começa antes do fim das etapas anteriores que já têm horário
      for (const sib of kids(p.id)) {
        if (sib.seq >= t.seq || wanted.has(sib.id)) continue;
        const e = lastEnd.get(sib.id);
        if (e && (!earliest || e > earliest)) earliest = e;
      }
    }
    out.push(taskInput(t, earliest));
  }
  return out;
}

export interface PlanOutcome {
  planId: string;
  mode: Settings["scheduleMode"];
  placed: number;
  unplaced: number;
}

/** Roda o agendador para as tarefas e grava como proposta ou direto, conforme o modo. */
export async function planTasks(
  taskIds: string[],
  trigger: PlanTrigger,
  opts: { captureId?: string | null; eventIds?: string[]; excluded?: string[]; forceMode?: Settings["scheduleMode"] } = {},
): Promise<PlanOutcome> {
  const settings = await getSettings();
  const mode = opts.forceMode ?? settings.scheduleMode;
  const excluded = new Set(opts.excluded ?? []);
  const input = await baseInput();
  input.tasks = await collectInputs(taskIds.filter((id) => !excluded.has(id)));
  const result = schedule(input);

  const planId = newId();
  const ts = nowIso();
  const plan: Plan = {
    id: planId,
    trigger,
    status: mode === "proposta" ? "proposta" : "aprovada",
    taskIds,
    excludedTaskIds: [...excluded],
    eventIds: opts.eventIds ?? [],
    captureId: opts.captureId ?? null,
    unplaced: result.unplaced,
    createdAt: ts,
    decidedAt: mode === "proposta" ? null : ts,
  };
  const blocks: Block[] = result.blocks.map((b) => ({
    id: newId(),
    taskId: b.taskId,
    planId,
    start: b.start,
    end: b.end,
    windowKind: b.windowKind,
    region: b.region,
    status: mode === "proposta" ? "proposto" : "confirmado",
    locked: false,
    createdAt: ts,
    updatedAt: ts,
  }));

  await db.transaction("rw", [db.plans, db.blocks, db.tasks], async () => {
    await db.plans.put(plan);
    await db.blocks.bulkPut(blocks);
    const reasons = new Map(result.unplaced.map((u) => [u.taskId, u.reason]));
    const placedIds = new Set(blocks.map((b) => b.taskId));
    for (const t of input.tasks) {
      const patch: Partial<Task> = { unplacedReason: reasons.get(t.id) ?? null, updatedAt: ts };
      if (mode === "direto" && placedIds.has(t.id)) patch.status = "agendada";
      await db.tasks.update(t.id, patch);
    }
    if (mode === "direto") await refreshParents(input.tasks.map((t) => t.id));
  });

  return { planId, mode, placed: new Set(blocks.map((b) => b.taskId)).size, unplaced: result.unplaced.length };
}

/** Refaz uma proposta (após editar tarefas ou mover um bloco). Blocos travados ficam. */
export async function replan(planId: string): Promise<void> {
  const plan = await db.plans.get(planId);
  if (!plan || plan.status !== "proposta") return;
  const old = await db.blocks.where("planId").equals(planId).toArray();
  const locked = old.filter((b) => b.locked);
  const lockedTasks = new Set(locked.map((b) => b.taskId));
  await db.blocks.bulkDelete(old.filter((b) => !b.locked).map((b) => b.id));

  const input = await baseInput();
  input.busy.push(...locked.map((b) => ({ id: b.id, taskId: b.taskId, start: b.start, end: b.end, windowKind: b.windowKind })));
  const excluded = new Set(plan.excludedTaskIds);
  input.tasks = (await collectInputs(plan.taskIds.filter((id) => !excluded.has(id)))).filter((t) => !lockedTasks.has(t.id));
  // etapas depois de uma etapa travada começam depois dela
  const lockedEnd = new Map(locked.map((b) => [b.taskId, b.end]));
  const all = new Map((await db.tasks.toArray()).map((t) => [t.id, t]));
  for (const ti of input.tasks) {
    const t = all.get(ti.id);
    if (!t?.parentId) continue;
    for (const [tid, end] of lockedEnd) {
      const sib = all.get(tid);
      if (sib?.parentId === t.parentId && sib.seq < t.seq && (!ti.earliestStart || end > ti.earliestStart)) ti.earliestStart = end;
    }
  }
  const result = schedule(input);
  const ts = nowIso();
  await db.blocks.bulkPut(
    result.blocks.map((b) => ({
      id: newId(),
      taskId: b.taskId,
      planId,
      start: b.start,
      end: b.end,
      windowKind: b.windowKind,
      region: b.region,
      status: "proposto" as const,
      locked: false,
      createdAt: ts,
      updatedAt: ts,
    })),
  );
  await db.plans.update(planId, { unplaced: result.unplaced });
  const reasons = new Map(result.unplaced.map((u) => [u.taskId, u.reason]));
  for (const t of input.tasks) await db.tasks.update(t.id, { unplacedReason: reasons.get(t.id) ?? null });
}

export async function approvePlan(planId: string): Promise<void> {
  const plan = await db.plans.get(planId);
  if (!plan) return;
  const ts = nowIso();
  await db.transaction("rw", [db.plans, db.blocks, db.tasks], async () => {
    const blocks = await db.blocks.where("planId").equals(planId).toArray();
    await db.blocks.bulkPut(blocks.map((b) => ({ ...b, status: "confirmado" as const, updatedAt: ts })));
    const placed = new Set(blocks.map((b) => b.taskId));
    for (const id of plan.taskIds) {
      const t = await db.tasks.get(id);
      if (!t) continue;
      if (placed.has(id)) await db.tasks.update(id, { status: "agendada", updatedAt: ts });
      else if (plan.excludedTaskIds.includes(id)) await db.tasks.update(id, { status: t.inferred ? "inbox" : "pendente", updatedAt: ts });
      else if (t.status === "inbox") await db.tasks.update(id, { status: "pendente", updatedAt: ts });
    }
    await refreshParents(plan.taskIds);
    await db.plans.update(planId, { status: "aprovada", decidedAt: ts });
  });
}

export async function discardPlan(planId: string): Promise<void> {
  const ts = nowIso();
  await db.transaction("rw", [db.plans, db.blocks], async () => {
    await db.blocks.where("planId").equals(planId).and((b) => b.status === "proposto").delete();
    await db.plans.update(planId, { status: "descartada", decidedAt: ts });
  });
}

/** Pais: agendada quando todas as subtarefas têm horário; concluída quando todas terminaram. */
async function refreshParents(taskIds: string[]): Promise<void> {
  const parents = new Set<string>();
  for (const id of taskIds) {
    const t = await db.tasks.get(id);
    if (t?.parentId) parents.add(t.parentId);
    else if (t) parents.add(t.id);
  }
  for (const pid of parents) {
    const kids = await db.tasks.where("parentId").equals(pid).toArray();
    if (!kids.length) continue;
    const live = kids.filter((k) => k.status !== "cancelada");
    let status: Task["status"] | null = null;
    if (live.every((k) => k.status === "concluida")) status = "concluida";
    else if (live.every((k) => k.status === "agendada" || k.status === "concluida" || k.status === "em_andamento")) status = "agendada";
    else status = "pendente";
    const p = await db.tasks.get(pid);
    if (p && p.status !== status && p.status !== "inbox") {
      await db.tasks.update(pid, { status, completedAt: status === "concluida" ? nowIso() : null });
    }
  }
}

// ---------------------------------------------------------------------------
// check-in
// ---------------------------------------------------------------------------

export type CheckinResponse = "terminei" | "mais_tempo" | "remarcar";

export interface CheckinOutcome {
  message: string;
  planId?: string;
}

export async function checkin(blockId: string, response: CheckinResponse, extraMin?: number): Promise<CheckinOutcome> {
  const block = await db.blocks.get(blockId);
  if (!block) return { message: "Bloco não encontrado" };
  const task = await db.tasks.get(block.taskId);
  const settings = await getSettings();
  const now = new Date();
  const ts = now.toISOString();
  await db.checkins.add({
    id: newId(),
    blockId,
    moment: "fim",
    response,
    extraMin: extraMin ?? null,
    channel: "tela",
    createdAt: ts,
  });

  if (response === "terminei") {
    const end = Date.parse(block.end) > now.getTime() && Date.parse(block.start) < now.getTime() ? ts : block.end;
    await db.blocks.update(blockId, { status: "concluido", end, updatedAt: ts });
    if (task) {
      const others = await db.blocks.where("taskId").equals(task.id).and((b) => b.id !== blockId && ACTIVE.includes(b.status)).count();
      const spent = Math.round((Date.parse(end) - Date.parse(block.start)) / 60000);
      await db.tasks.update(task.id, {
        actualMin: (task.actualMin ?? 0) + Math.max(0, spent),
        ...(others === 0 ? { status: "concluida" as const, completedAt: ts } : {}),
        updatedAt: ts,
      });
      await refreshParents([task.id]);
    }
    return { message: "Boa! Tarefa concluída." };
  }

  if (response === "mais_tempo") {
    const extra = extraMin ?? settings.moreTimeDefaultMin;
    const newEnd = new Date(Math.max(Date.parse(block.end), now.getTime()) + extra * 60000).toISOString();
    await db.blocks.update(blockId, { end: newEnd, status: "em_andamento", updatedAt: ts });
    if (task) await db.tasks.update(task.id, { durationMin: task.durationMin + extra, updatedAt: ts });
    // tarefas seguintes que agora conflitam saem e são re-encaixadas
    const limit = Date.parse(newEnd) + settings.taskBufferMin * 60000;
    const bumped = (await db.blocks.where("status").equals("confirmado").toArray()).filter(
      (b) => b.id !== blockId && !b.locked && Date.parse(b.start) < limit && Date.parse(b.start) >= Date.parse(block.start),
    );
    if (!bumped.length) return { message: `Mais ${extra} min. Nada mais precisou mudar.` };
    const out = await reschedule(bumped, "checkin");
    return {
      message:
        out.mode === "proposta"
          ? `Mais ${extra} min. ${bumped.length} tarefa(s) precisam de novo horário: veja a proposta.`
          : `Mais ${extra} min. ${out.placed} tarefa(s) remarcada(s) automaticamente.`,
      planId: out.mode === "proposta" ? out.planId : undefined,
    };
  }

  // remarcar
  await db.blocks.update(blockId, { status: "remarcado", updatedAt: ts });
  if (task) {
    await db.tasks.update(task.id, {
      status: "pendente",
      earliestStart: new Date(now.getTime() + 30 * 60000).toISOString(),
      updatedAt: ts,
    });
  }
  const out = await reschedule([], "checkin", task ? [task.id] : []);
  return {
    message: out.mode === "proposta" ? "Veja a proposta com o novo horário." : out.unplaced ? "Não achei horário na semana; a tarefa foi para a Caixa de entrada." : "Remarcada.",
    planId: out.mode === "proposta" ? out.planId : undefined,
  };
}

/** Tira blocos da agenda (e das etapas seguintes da mesma tarefa) e re-encaixa. */
async function reschedule(blocks: Block[], trigger: PlanTrigger, extraTaskIds: string[] = []): Promise<PlanOutcome> {
  const ts = nowIso();
  const taskIds = new Set([...blocks.map((b) => b.taskId), ...extraTaskIds]);
  // etapas posteriores da mesma tarefa também saem, para manter a ordem
  for (const id of [...taskIds]) {
    const t = await db.tasks.get(id);
    if (!t?.parentId) continue;
    const later = await db.tasks.where("parentId").equals(t.parentId).and((s) => s.seq > t.seq && !DONE_TASK.includes(s.status)).toArray();
    for (const s of later) taskIds.add(s.id);
  }
  const toRemove = (await db.blocks.where("taskId").anyOf([...taskIds]).toArray()).filter((b) => ACTIVE.includes(b.status) && b.status !== "em_andamento");
  await db.blocks.bulkUpdate(toRemove.map((b) => ({ key: b.id, changes: { status: "remarcado" as const, updatedAt: ts } })));
  for (const id of taskIds) {
    const t = await db.tasks.get(id);
    if (t && !DONE_TASK.includes(t.status)) await db.tasks.update(id, { status: "pendente", updatedAt: ts });
  }
  return planTasks([...taskIds], trigger);
}

/** Blocos confirmados que já terminaram e ainda não tiveram check-in. */
export async function pendingCheckins(now = Date.now()): Promise<Block[]> {
  const ended = (await db.blocks.where("status").anyOf(ACTIVE).toArray()).filter((b) => Date.parse(b.end) <= now);
  return ended.sort((a, b) => a.end.localeCompare(b.end));
}

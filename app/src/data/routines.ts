// Rotinas recorrentes: cada ocorrência vira uma tarefa (com etapas) que o
// agendador encaixa como qualquer outra.
import { hhmmToMin, localToMin, minToIso, occurrences } from "@shared/scheduler/index.ts";
import { addDaysLocal, todayLocal } from "../lib/format";
import { db, newId, nowIso } from "./db";
import { planTasks, type PlanOutcome } from "./planner";
import { getSettings } from "./routine";
import type { Routine, RoutineTemplate, Task } from "./types";

export function emptyTemplate(): RoutineTemplate {
  return {
    title: "",
    category: "pessoal",
    durationMin: 60,
    location: "qualquer",
    region: null,
    priority: 2,
    isCooking: false,
    splittable: false,
    alertMode: null,
    notes: null,
    subtasks: [],
  };
}

function instance(r: Routine, date: string, tz: string): Task[] {
  const t = r.template;
  const ts = nowIso();
  const start = r.preferredStart ? hhmmToMin(r.preferredStart) : 0;
  const end = r.preferredEnd ? hhmmToMin(r.preferredEnd) : 1439;
  const rootId = newId();
  const base = {
    captureId: null,
    routineId: r.id,
    routineDate: date,
    notes: t.notes,
    category: t.category,
    actualMin: null,
    alertMode: t.alertMode,
    isCooking: t.isCooking,
    inferred: false,
    status: "pendente" as const,
    unplacedReason: null,
    completedAt: null,
    createdAt: ts,
    updatedAt: ts,
    earliestStart: minToIso(localToMin(date, start, tz), tz),
    deadline: minToIso(localToMin(date, Math.max(end, start + 5), tz), tz),
    deadlineHard: false,
    priority: t.priority,
  };
  const root: Task = {
    ...base,
    id: rootId,
    parentId: null,
    seq: 0,
    title: t.title || r.title,
    durationMin: t.subtasks.length ? t.subtasks.reduce((a, s) => a + s.durationMin, 0) : t.durationMin,
    location: t.location,
    region: t.location === "rua" ? t.region : null,
    splittable: t.splittable && !t.subtasks.length,
    minChunkMin: t.splittable ? 30 : null,
  };
  const kids: Task[] = t.subtasks.map((s, i) => ({
    ...base,
    id: newId(),
    parentId: rootId,
    seq: i,
    title: s.title,
    notes: null,
    routineDate: null,
    earliestStart: null,
    deadline: null,
    durationMin: s.durationMin,
    location: s.location,
    region: s.location === "rua" ? s.region : null,
    splittable: false,
    minChunkMin: null,
  }));
  return [root, ...kids];
}

let running: Promise<string[]> | null = null;

/**
 * Cria as tarefas das ocorrências ainda não geradas dentro do horizonte.
 * Ocorrências já geradas (mesmo apagadas) não voltam. Devolve os ids criados.
 */
export function createRoutineInstances(): Promise<string[]> {
  running ??= doCreate().finally(() => (running = null));
  return running;
}

/** Cria as ocorrências e manda agendar. */
export async function generateRoutineTasks(): Promise<PlanOutcome | null> {
  const created = await createRoutineInstances();
  return created.length ? planTasks(created, "rotina") : null;
}

async function doCreate(): Promise<string[]> {
  const settings = await getSettings();
  const today = todayLocal();
  const until = addDaysLocal(today, settings.horizonDays - 1);
  const routines = (await db.routines.toArray()).filter((r) => r.active);
  const created: string[] = [];
  for (const r of routines) {
    const from = r.generatedUntil && r.generatedUntil >= today ? addDaysLocal(r.generatedUntil, 1) : today;
    if (from > until) continue;
    const done = new Set((await db.tasks.where("routineId").equals(r.id).toArray()).map((t) => t.routineDate));
    const dates = occurrences(r.rrule, r.startDate, from, until).filter((d) => !done.has(d));
    const tasks = dates.flatMap((d) => instance(r, d, settings.timezone));
    await db.transaction("rw", [db.tasks, db.routines], async () => {
      if (tasks.length) await db.tasks.bulkAdd(tasks);
      await db.routines.update(r.id, { generatedUntil: until });
    });
    created.push(...tasks.filter((t) => !t.parentId).map((t) => t.id));
  }
  return created;
}

/** Ocorrências futuras ainda não feitas de uma rotina. */
async function futureInstances(routineId: string): Promise<Task[]> {
  const today = todayLocal();
  return (await db.tasks.where("routineId").equals(routineId).toArray()).filter(
    (t) => !t.parentId && (t.routineDate ?? "") >= today && t.status !== "concluida",
  );
}

async function removeInstances(roots: Task[]) {
  for (const t of roots) {
    const ids = [t.id, ...(await db.tasks.where("parentId").equals(t.id).primaryKeys())];
    const blocks = await db.blocks.where("taskId").anyOf(ids).toArray();
    await db.blocks.bulkDelete(blocks.filter((b) => b.status !== "concluido").map((b) => b.id));
    await db.tasks.bulkDelete(ids);
  }
}

/** Salva e regenera as próximas ocorrências com o modelo novo. */
export async function saveRoutine(r: Routine): Promise<PlanOutcome | null> {
  const ts = nowIso();
  const exists = await db.routines.get(r.id);
  if (exists) await removeInstances(await futureInstances(r.id));
  await db.routines.put({ ...r, generatedUntil: addDaysLocal(todayLocal(), -1), createdAt: exists?.createdAt ?? ts, updatedAt: ts });
  return generateRoutineTasks();
}

export async function deleteRoutine(id: string): Promise<void> {
  await removeInstances(await futureInstances(id));
  await db.routines.delete(id);
}

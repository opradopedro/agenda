// Captura → IA → tarefas/eventos → agendador.
import { localToMin, minToIso } from "@shared/scheduler/index.ts";
import type { Interpretation } from "@shared/interpret/contract.ts";
import { interpret } from "../lib/api";
import { db, newId, nowIso } from "./db";
import { planTasks, type PlanOutcome } from "./planner";
import { getSettings, routineSummary } from "./routine";
import type { AgendaEvent, Capture, Task } from "./types";

export async function submitCapture(text: string, input: Capture["input"]): Promise<{ captureId: string; outcome?: PlanOutcome; questions: string[] }> {
  const capture: Capture = {
    id: newId(),
    rawText: text.trim(),
    input,
    status: "pendente",
    llmResult: null,
    llmModel: null,
    error: null,
    createdAt: nowIso(),
  };
  await db.captures.add(capture);
  return processCapture(capture.id);
}

export async function processCapture(captureId: string): Promise<{ captureId: string; outcome?: PlanOutcome; questions: string[] }> {
  const cap = await db.captures.get(captureId);
  if (!cap) throw new Error("captura não encontrada");
  await db.captures.update(captureId, { status: "interpretando", error: null });

  const settings = await getSettings();
  const places = await db.places.toArray();
  const home = places.find((p) => p.kind === "casa");
  let result;
  try {
    result = await interpret(cap.rawText, {
      now: minToIso(Math.floor(Date.now() / 60000), settings.timezone),
      timezone: settings.timezone,
      regions: [...new Set(places.map((p) => p.region).filter((r): r is string => !!r))],
      homeRegion: home?.region ?? null,
      routine: routineSummary(settings),
    });
  } catch (e) {
    await db.captures.update(captureId, { status: "erro", error: (e as Error).message });
    throw e;
  }

  const { taskIds, eventIds, inferredIds } = await materialize(captureId, result.interpretation);
  await db.captures.update(captureId, { status: "interpretado", llmResult: result.interpretation, llmModel: result.model });
  const outcome = taskIds.length || eventIds.length
    ? await planTasks(taskIds, "captura", { captureId, eventIds, excluded: inferredIds })
    : undefined;
  return { captureId, outcome, questions: result.interpretation.questions };
}

async function materialize(captureId: string, it: Interpretation) {
  const settings = await getSettings();
  const tz = settings.timezone;
  const ts = nowIso();
  const tasks: Task[] = [];
  const events: AgendaEvent[] = [];
  const taskIds: string[] = [];
  const inferredIds: string[] = [];

  for (const e of it.events) {
    const allDay = !e.start;
    const startMin = localToMin(e.date, allDay ? 0 : toMin(e.start!), tz);
    const endMin = allDay ? localToMin(e.date, 1440, tz) : e.end ? localToMin(e.date, toMin(e.end), tz) : startMin + 60;
    events.push({
      id: newId(),
      source: "captura",
      title: e.title,
      category: e.category,
      start: minToIso(startMin, tz),
      end: minToIso(Math.max(endMin, startMin + 15), tz),
      allDay,
      blocksTime: !allDay,
      placeId: null,
      locationText: e.location_text,
      captureId,
      createdAt: ts,
    });
  }

  for (const t of it.tasks) {
    const id = newId();
    const base = {
      captureId,
      notes: t.notes,
      category: t.category,
      actualMin: null,
      alertMode: null,
      isCooking: t.is_cooking,
      inferred: t.inferred,
      status: (t.inferred ? "inbox" : "pendente") as Task["status"],
      unplacedReason: null,
      completedAt: null,
      createdAt: ts,
      updatedAt: ts,
    };
    tasks.push({
      ...base,
      id,
      parentId: null,
      seq: 0,
      title: t.title,
      durationMin: t.duration_min,
      earliestStart: t.earliest_start,
      deadline: t.deadline,
      deadlineHard: t.deadline_hard,
      priority: t.priority,
      location: t.location,
      region: t.region,
      splittable: t.splittable,
      minChunkMin: t.splittable ? 30 : null,
    });
    t.subtasks.forEach((s, i) => {
      tasks.push({
        ...base,
        id: newId(),
        parentId: id,
        seq: i,
        title: s.title,
        notes: null,
        durationMin: s.duration_min,
        earliestStart: null,
        deadline: null,
        deadlineHard: t.deadline_hard,
        priority: t.priority,
        location: s.location,
        region: s.region,
        splittable: false,
        minChunkMin: null,
      });
    });
    taskIds.push(id);
    if (t.inferred) inferredIds.push(id);
  }

  await db.transaction("rw", [db.tasks, db.events], async () => {
    await db.tasks.bulkAdd(tasks);
    await db.events.bulkAdd(events);
  });
  return { taskIds, eventIds: events.map((e) => e.id), inferredIds };
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

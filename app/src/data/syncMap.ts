// Mapa entre as tabelas locais (camelCase) e as do Postgres (snake_case).
// Só os campos listados viajam: colunas que o servidor controla (ex.:
// gcal_event_id) nunca são sobrescritas pelo app.
import { minToIso } from "@shared/scheduler/index.ts";
import type { SyncedTable } from "./db";

export interface TableMap {
  server: string;
  /** campo local → coluna (nome igual em snake_case quando ausente) */
  fields: string[];
  rename?: Record<string, string>;
  /** colunas timestamptz usadas em comparações: voltam no formato com o fuso local */
  instants?: string[];
  /** colunas time: voltam como HH:MM */
  times?: string[];
}

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export const MAPS: Record<Exclude<SyncedTable, "settings">, TableMap> = {
  places: { server: "places", fields: ["id", "kind", "name", "region"] },
  travel: { server: "travel_times", fields: ["id", "fromPlaceId", "toPlaceId", "minutes"] },
  commitments: {
    server: "fixed_commitments",
    fields: ["id", "title", "category", "weekday", "start", "end", "placeId", "active", "origin"],
    rename: { start: "start_time", end: "end_time" },
    times: ["start", "end"],
  },
  captures: { server: "captures", fields: ["id", "rawText", "input", "status", "llmResult", "llmModel", "error", "createdAt"] },
  events: {
    server: "events",
    fields: ["id", "source", "title", "category", "start", "end", "allDay", "blocksTime", "placeId", "locationText", "captureId", "createdAt"],
    rename: { start: "start_at", end: "end_at" },
    instants: ["start", "end"],
  },
  routines: {
    server: "routines",
    fields: ["id", "title", "rrule", "template", "preferredStart", "preferredEnd", "startDate", "active", "generatedUntil", "createdAt"],
    times: ["preferredStart", "preferredEnd"],
  },
  tasks: {
    server: "tasks",
    fields: [
      "id", "parentId", "seq", "captureId", "routineId", "routineDate", "title", "notes", "category", "durationMin", "actualMin",
      "earliestStart", "deadline", "deadlineHard", "priority", "location", "region", "alertMode", "splittable", "minChunkMin",
      "isCooking", "inferred", "status", "unplacedReason", "completedAt", "createdAt",
    ],
    rename: { earliestStart: "earliest_start_at", deadline: "deadline_at", location: "location_req" },
    instants: ["earliestStart", "deadline"],
  },
  plans: {
    server: "plans",
    fields: ["id", "trigger", "status", "taskIds", "excludedTaskIds", "eventIds", "captureId", "unplaced", "createdAt", "decidedAt"],
    rename: { trigger: "reason" },
  },
  blocks: {
    server: "schedule_blocks",
    fields: ["id", "taskId", "planId", "start", "end", "windowKind", "region", "status", "locked", "createdAt"],
    rename: { start: "start_at", end: "end_at" },
    instants: ["start", "end"],
  },
  checkins: { server: "checkins", fields: ["id", "blockId", "moment", "response", "extraMin", "channel", "createdAt"] },
  recipes: {
    server: "recipes",
    fields: ["id", "taskId", "title", "servings", "prepMin", "activeMin", "ingredients", "steps", "healthNotes", "chosen", "createdAt"],
  },
  shoppingLists: { server: "shopping_lists", fields: ["id", "taskId", "title", "createdAt"] },
  shoppingItems: { server: "shopping_items", fields: ["id", "listId", "name", "qty", "unit", "section", "recipeIds", "checked"] },
};

/** Ordem de envio: quem é referenciado vai antes. */
export const PUSH_ORDER: Exclude<SyncedTable, "settings">[] = [
  "places", "travel", "commitments", "captures", "events", "routines", "tasks", "plans", "blocks", "checkins",
  "recipes", "shoppingLists", "shoppingItems",
];

const col = (m: TableMap, f: string) => m.rename?.[f] ?? snake(f);

export function toServer(m: TableMap, row: Record<string, unknown>, userId: string): Record<string, unknown> {
  const out: Record<string, unknown> = { user_id: userId };
  for (const f of m.fields) if (f in row) out[col(m, f)] = row[f] === undefined ? null : row[f];
  return out;
}

export function fromServer(m: TableMap, row: Record<string, unknown>, tz: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of m.fields) {
    let v = row[col(m, f)];
    if (v !== null && v !== undefined) {
      if (m.instants?.includes(f)) v = minToIso(Math.floor(Date.parse(v as string) / 60000), tz);
      if (m.times?.includes(f)) v = (v as string).slice(0, 5);
    }
    out[f] = v ?? null;
  }
  out.updatedAt = row.updated_at;
  return out;
}

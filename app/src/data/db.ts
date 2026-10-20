import Dexie, { type Table } from "dexie";
import type {
  AgendaEvent,
  Block,
  Capture,
  Checkin,
  Commitment,
  KV,
  Place,
  Plan,
  Recipe,
  Routine,
  Settings,
  ShoppingItem,
  ShoppingList,
  Task,
  Travel,
} from "./types";

class AgendaDB extends Dexie {
  settings!: Table<Settings, string>;
  places!: Table<Place, string>;
  travel!: Table<Travel, string>;
  commitments!: Table<Commitment, string>;
  events!: Table<AgendaEvent, string>;
  captures!: Table<Capture, string>;
  tasks!: Table<Task, string>;
  plans!: Table<Plan, string>;
  blocks!: Table<Block, string>;
  checkins!: Table<Checkin, string>;
  routines!: Table<Routine, string>;
  recipes!: Table<Recipe, string>;
  shoppingLists!: Table<ShoppingList, string>;
  shoppingItems!: Table<ShoppingItem, string>;
  kv!: Table<KV, string>;

  constructor() {
    super("agenda");
    this.version(1).stores({
      settings: "id",
      places: "id, kind",
      travel: "id",
      commitments: "id, weekday",
      events: "id, start, captureId",
      captures: "id, status, createdAt",
      tasks: "id, status, parentId, captureId",
      plans: "id, status, createdAt",
      blocks: "id, taskId, planId, start, status",
      checkins: "id, blockId",
    });
    this.version(2)
      .stores({
        tasks: "id, status, parentId, captureId, routineId",
        events: "id, start, captureId, source",
        routines: "id",
        recipes: "id, taskId",
        shoppingLists: "id, taskId",
        shoppingItems: "id, listId",
        kv: "key",
      })
      .upgrade(async (tx) => {
        // ids da rotina eram textos ("place-casa", "est-1"); no Postgres são uuid
        const placeMap = new Map<string, string>();
        const fix = (id: string | null) => (id && placeMap.get(id)) || id;
        const places = (await tx.table("places").toArray()) as Place[];
        for (const p of places) if (!isUuid(p.id)) placeMap.set(p.id, newId());
        await tx.table("places").clear();
        await tx.table("places").bulkAdd(places.map((p) => ({ ...p, id: fix(p.id)! })));
        const travel = (await tx.table("travel").toArray()) as Travel[];
        await tx.table("travel").clear();
        await tx.table("travel").bulkAdd(
          travel.map((t) => ({ ...t, id: isUuid(t.id) ? t.id : newId(), fromPlaceId: fix(t.fromPlaceId)!, toPlaceId: fix(t.toPlaceId)! })),
        );
        const commitments = (await tx.table("commitments").toArray()) as Commitment[];
        await tx.table("commitments").clear();
        await tx.table("commitments").bulkAdd(commitments.map((c) => ({ ...c, id: isUuid(c.id) ? c.id : newId(), placeId: fix(c.placeId) })));
        await tx.table("events").toCollection().modify((e: AgendaEvent) => {
          e.placeId = fix(e.placeId);
        });
      });
  }
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export const db = new AgendaDB();

export const newId = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Controle de alterações para a sincronização (Fase 2): toda escrita local
// marca a linha como "_dirty"; exclusões viram lápides. O sync limpa as marcas.
// ---------------------------------------------------------------------------

export const SYNCED_TABLES = [
  "settings", "places", "travel", "commitments", "captures", "events", "routines", "tasks",
  "plans", "blocks", "checkins", "recipes", "shoppingLists", "shoppingItems",
] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

let applyingRemote = 0;
/** Escritas vindas do servidor não devem ser marcadas para reenvio. */
export async function asRemote<T>(fn: () => Promise<T>): Promise<T> {
  applyingRemote++;
  try {
    return await fn();
  } finally {
    applyingRemote--;
  }
}

const TOMBSTONES = "agenda.tombstones";
export function readTombstones(): { table: SyncedTable; id: string }[] {
  try {
    return JSON.parse(localStorage.getItem(TOMBSTONES) ?? "[]");
  } catch {
    return [];
  }
}
export function writeTombstones(list: { table: SyncedTable; id: string }[]) {
  try {
    localStorage.setItem(TOMBSTONES, JSON.stringify(list));
  } catch {
    // sem localStorage: a exclusão fica só neste aparelho
  }
}

for (const name of SYNCED_TABLES) {
  const table = db.table(name);
  table.hook("creating", (_key, obj) => {
    if (applyingRemote) return;
    obj._dirty = 1;
    obj.updatedAt = nowIso();
  });
  table.hook("updating", (mods) => {
    if (applyingRemote) return;
    const keys = Object.keys(mods);
    if (keys.length === 1 && keys[0] === "_dirty") return;
    return { _dirty: 1, updatedAt: nowIso() };
  });
  table.hook("deleting", (key) => {
    if (applyingRemote) return;
    writeTombstones([...readTombstones(), { table: name, id: String(key) }]);
  });
}

import Dexie, { type Table } from "dexie";
import type {
  AgendaEvent,
  Block,
  Capture,
  Checkin,
  Commitment,
  Place,
  Plan,
  Settings,
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
  }
}

export const db = new AgendaDB();

export const newId = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

import { describe, expect, it } from "vitest";
import { fromServer, MAPS, toServer } from "../src/data/syncMap";

describe("mapa do sync", () => {
  it("tarefa: renomeia colunas e não envia campos do servidor", () => {
    const local = { id: "t1", title: "X", deadline: "2026-10-21T23:59:00-03:00", location: "rua", durationMin: 30, _dirty: 1, gcalEventId: "nao-enviar" };
    const row = toServer(MAPS.tasks, local, "u1");
    expect(row).toMatchObject({ user_id: "u1", id: "t1", deadline_at: local.deadline, location_req: "rua", duration_min: 30 });
    expect(row).not.toHaveProperty("_dirty");
    expect(row).not.toHaveProperty("gcal_event_id");
  });

  it("bloco vindo do servidor volta no fuso local e com updatedAt do servidor", () => {
    const back = fromServer(MAPS.blocks, { id: "b1", task_id: "t1", start_at: "2026-10-21T19:00:00+00:00", end_at: "2026-10-21T20:00:00+00:00", status: "confirmado", updated_at: "2026-10-20T10:00:00.123+00:00", gcal_event_id: "g1" }, "America/Sao_Paulo");
    expect(back).toMatchObject({ id: "b1", taskId: "t1", start: "2026-10-21T16:00:00-03:00", end: "2026-10-21T17:00:00-03:00", updatedAt: "2026-10-20T10:00:00.123+00:00" });
    expect(back).not.toHaveProperty("gcalEventId");
  });

  it("horários (time) voltam como HH:MM", () => {
    const back = fromServer(MAPS.commitments, { id: "c1", start_time: "09:00:00", end_time: "16:00:00", weekday: 1 }, "America/Sao_Paulo");
    expect(back).toMatchObject({ start: "09:00", end: "16:00" });
  });
});

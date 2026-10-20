import { describe, expect, it } from "vitest";
import { awakeAt, dueMessages } from "../../supabase/functions/_shared/push/messages.ts";

const settings = {
  timezone: "America/Sao_Paulo",
  routine: { sleep: { sameTime: true, wake: "07:00", sleep: "00:00" } },
  notifyStart: true,
  notifyEnd: true,
  reminderLeadMin: 0,
};
const at = (iso: string) => Date.parse(iso);
const block = { id: "b1", task_id: "t1", start_at: "2026-10-21T16:00:00-03:00", end_at: "2026-10-21T17:00:00-03:00", region: "Santos", window_kind: "fora" };
const tasks = new Map([["t1", { id: "t1", title: "Mercado", alert_mode: null, parent_id: null }]]);

describe("notificações", () => {
  it("silêncio segue o horário de dormir/acordar", () => {
    expect(awakeAt(at("2026-10-21T10:00:00-03:00"), settings)).toBe(true);
    expect(awakeAt(at("2026-10-21T03:00:00-03:00"), settings)).toBe(false);
    expect(awakeAt(at("2026-10-21T23:30:00-03:00"), settings)).toBe(true);
  });

  it("sexta dormindo às 2h: 01:00 ainda é acordado", () => {
    const s = { ...settings, routine: { sleep: { sameTime: false, days: { 5: { wake: "07:00", sleep: "02:00" } } } } };
    expect(awakeAt(at("2026-10-24T01:00:00-03:00"), s)).toBe(true); // madrugada de sábado, ainda é a noite de sexta
  });

  it("início e fim no minuto certo, com botões no fim", () => {
    const start = dueMessages(at("2026-10-21T16:00:20-03:00"), [block], tasks, settings, "https://x/");
    expect(start).toHaveLength(1);
    expect(start[0]).toMatchObject({ kind: "inicio", title: "Agora: Mercado", body: "16:00–17:00 · em Santos" });
    const end = dueMessages(at("2026-10-21T17:00:30-03:00"), [block], tasks, settings, "https://x/");
    expect(end[0].kind).toBe("fim");
    expect(end[0].actions.map((a) => a.action)).toEqual(["terminei", "mais_tempo"]);
    expect(dueMessages(at("2026-10-21T16:30:00-03:00"), [block], tasks, settings, "https://x/")).toHaveLength(0);
  });

  it("aviso 'nenhum' e tipos desligados não notificam", () => {
    const quiet = new Map([["t1", { id: "t1", title: "Mercado", alert_mode: "nenhum", parent_id: null }]]);
    expect(dueMessages(at("2026-10-21T16:00:00-03:00"), [block], quiet, settings, "https://x/")).toHaveLength(0);
    expect(dueMessages(at("2026-10-21T16:00:00-03:00"), [block], tasks, { ...settings, notifyStart: false }, "https://x/")).toHaveLength(0);
  });

  it("alarme exige interação e toca mesmo no modo silencioso", () => {
    const alarm = new Map([["t1", { id: "t1", title: "Prova", alert_mode: "alarme", parent_id: null }]]);
    const [m] = dueMessages(at("2026-10-21T16:00:00-03:00"), [block], alarm, { ...settings, silentMode: true }, "https://x/");
    expect(m).toMatchObject({ requireInteraction: true, silent: false });
  });
});

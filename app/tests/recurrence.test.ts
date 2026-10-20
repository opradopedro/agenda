import { describe, expect, it } from "vitest";
import { describeRrule, occurrences, parseRrule, toRrule } from "../../supabase/functions/_shared/scheduler/index.ts";

describe("recorrência", () => {
  it("lê e escreve BYDAY/INTERVAL", () => {
    expect(parseRrule("FREQ=WEEKLY;BYDAY=WE,MO")).toEqual({ weekdays: [1, 3], interval: 1 });
    expect(toRrule({ weekdays: [3], interval: 2 })).toBe("FREQ=WEEKLY;BYDAY=WE;INTERVAL=2");
  });

  it("marmita toda quarta: ocorrências nas próximas duas semanas", () => {
    expect(occurrences("FREQ=WEEKLY;BYDAY=WE", "2026-10-12", "2026-10-12", "2026-10-25")).toEqual(["2026-10-14", "2026-10-21"]);
  });

  it("a cada 2 semanas pula uma semana", () => {
    expect(occurrences("FREQ=WEEKLY;BYDAY=FR;INTERVAL=2", "2026-10-12", "2026-10-12", "2026-11-08")).toEqual(["2026-10-16", "2026-10-30"]);
  });

  it("não gera antes da data de início", () => {
    expect(occurrences("FREQ=WEEKLY;BYDAY=MO", "2026-10-20", "2026-10-12", "2026-10-27")).toEqual(["2026-10-26"]);
  });

  it("descreve em português", () => {
    expect(describeRrule("FREQ=WEEKLY;BYDAY=WE")).toBe("toda quarta");
    expect(describeRrule("FREQ=WEEKLY;BYDAY=MO,TH")).toBe("toda segunda e quinta");
    expect(describeRrule("FREQ=WEEKLY;BYDAY=SA")).toBe("todo sábado");
  });
});

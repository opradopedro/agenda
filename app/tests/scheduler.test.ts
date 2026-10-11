import { describe, expect, it } from "vitest";
import {
  dayTimeline,
  schedule,
  type ScheduleInput,
  type TaskInput,
} from "../../supabase/functions/_shared/scheduler/index.ts";

// Rotina do Pedro: casa em Praia Grande; trabalho, terminal e faculdade em Santos.
// Semana de teste: seg 12/10/2026. Terminal na quinta; home office na quarta.
const places: ScheduleInput["places"] = [
  { id: "casa", kind: "casa", name: "Casa", region: "Praia Grande" },
  { id: "trab", kind: "trabalho", name: "Escritório", region: "Santos" },
  { id: "term", kind: "terminal", name: "Terminal", region: "Santos" },
  { id: "facu", kind: "faculdade", name: "Faculdade", region: "Santos" },
];
const travel: ScheduleInput["travel"] = [
  { fromPlaceId: "casa", toPlaceId: "trab", minutes: 60 },
  { fromPlaceId: "casa", toPlaceId: "term", minutes: 60 },
  { fromPlaceId: "trab", toPlaceId: "facu", minutes: 15 },
  { fromPlaceId: "term", toPlaceId: "facu", minutes: 15 },
  { fromPlaceId: "facu", toPlaceId: "casa", minutes: 40 },
];
const estagio = (weekday: number, placeId: string) => ({
  id: `est-${weekday}`,
  title: "Estágio",
  weekday,
  start: "09:00",
  end: "16:00",
  placeId,
});
const facu = (weekday: number) => ({
  id: `facu-${weekday}`,
  title: "Faculdade",
  weekday,
  start: "19:00",
  end: "23:00",
  placeId: "facu",
});

function base(over: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    now: "2026-10-12T07:00:00-03:00",
    horizonDays: 7,
    settings: {
      timezone: "America/Sao_Paulo",
      wakeTime: "07:00",
      sleepTime: "00:00",
      quietStart: "00:00",
      quietEnd: null,
      slotGranularityMin: 15,
      taskBufferMin: 10,
      returnHomeInGaps: false,
      goHomeMinStayMin: 120,
      errandFromHomeOverheadMin: 30,
      lateHour: "22:00",
    },
    places,
    travel,
    commitments: [
      estagio(1, "trab"),
      estagio(2, "trab"),
      estagio(3, "casa"),
      estagio(4, "term"),
      estagio(5, "trab"),
      facu(1),
      facu(2),
      facu(3),
      facu(4),
    ],
    events: [],
    tasks: [],
    busy: [],
    ...over,
  };
}

const task = (t: Partial<TaskInput> & { id: string }): TaskInput => ({
  title: t.id,
  durationMin: 60,
  priority: 2,
  location: "qualquer",
  ...t,
});

const hm = (iso: string) => iso.slice(11, 16);
const day = (iso: string) => iso.slice(0, 10);

describe("linha do tempo", () => {
  it("dia de escritório: 16h–18h45 livre em Santos, não em casa", () => {
    const tl = dayTimeline("2026-10-12", base());
    const simple = tl.map((s) => `${s.kind}:${hm(s.start)}-${hm(s.end)}${s.windowKind ? `:${s.windowKind}` : ""}${s.region ? `:${s.region}` : ""}`);
    expect(simple).toEqual([
      "janela:07:00-08:00:casa:Praia Grande",
      "deslocamento:08:00-09:00",
      "compromisso:09:00-16:00:fora:Santos",
      "janela:16:00-18:45:fora:Santos",
      "deslocamento:18:45-19:00",
      "compromisso:19:00-23:00:fora:Santos",
      "janela:23:00-23:20:fora:Santos",
      "deslocamento:23:00-23:40",
      "janela:23:40-00:00:casa:Praia Grande",
    ]);
  });

  it("home office (quarta): tarde inteira em casa até sair para a faculdade", () => {
    const tl = dayTimeline("2026-10-14", base());
    const casa = tl.filter((s) => s.kind === "janela" && s.windowKind === "casa").map((s) => `${hm(s.start)}-${hm(s.end)}`);
    expect(casa).toContain("07:00-09:00");
    expect(casa).toContain("16:00-18:20");
  });

  it("volta para casa no intervalo só quando ligado e compensa", () => {
    const on = base({ settings: { ...base().settings, returnHomeInGaps: true, goHomeMinStayMin: 60 } });
    // 16h→19h: 60 (volta) + 40 (ida) = 1h40; sobra 1h20 ≥ 1h → volta
    const tl = dayTimeline("2026-10-12", on);
    expect(tl.some((s) => s.kind === "janela" && s.windowKind === "casa" && hm(s.start) === "17:00")).toBe(true);
    // com o padrão de 2h não compensa
    const off = base({ settings: { ...base().settings, returnHomeInGaps: true } });
    expect(dayTimeline("2026-10-12", off).some((s) => s.windowKind === "casa" && hm(s.start) === "17:00")).toBe(false);
  });
});

describe("encaixe", () => {
  it("cozinhar (casa) nunca cai no intervalo em Santos", () => {
    const r = schedule(base({ tasks: [task({ id: "cozinhar", durationMin: 90, location: "casa" })] }));
    expect(r.unplaced).toEqual([]);
    expect(r.blocks[0].windowKind).toBe("casa");
    // seg/ter só têm 1h em casa de manhã → vai para a quarta
    expect(day(r.blocks[0].start)).toBe("2026-10-14");
  });

  it("cabelo (rua, sem região) vai para o intervalo em Santos", () => {
    const r = schedule(base({ tasks: [task({ id: "cabelo", durationMin: 45, location: "rua" })] }));
    expect(r.blocks[0]).toMatchObject({ windowKind: "fora", region: "Santos" });
    expect(r.blocks[0].start).toBe("2026-10-12T16:00:00-03:00");
  });

  it("dentista em Praia Grande sai de casa, com tempo de ida e volta", () => {
    const r = schedule(base({ tasks: [task({ id: "dentista", location: "rua", region: "Praia Grande" })] }));
    expect(r.blocks[0]).toMatchObject({ windowKind: "casa", region: "Praia Grande" });
    // 60 min + 30 de ida/volta não cabem na 1h de seg/ter de manhã
    expect(day(r.blocks[0].start)).toBe("2026-10-14");
    expect(hm(r.blocks[0].start)).toBe("07:15");
  });

  it("marmita: comprar → cozinhar → porcionar, em ordem e no lugar certo", () => {
    const r = schedule(
      base({
        tasks: [
          task({ id: "marmita", durationMin: 150, location: "qualquer", deadline: "2026-10-18T12:00:00-03:00", deadlineHard: false, priority: 3 }),
          task({ id: "comprar", parentId: "marmita", seq: 0, durationMin: 40, location: "rua" }),
          task({ id: "cozinhar", parentId: "marmita", seq: 1, durationMin: 90, location: "casa" }),
          task({ id: "porcionar", parentId: "marmita", seq: 2, durationMin: 20, location: "casa" }),
        ],
      }),
    );
    expect(r.unplaced).toEqual([]);
    const by = Object.fromEntries(r.blocks.map((b) => [b.taskId, b]));
    expect(by.marmita).toBeUndefined(); // o pai é só contêiner
    expect(by.comprar.windowKind).toBe("fora");
    expect(by.cozinhar.windowKind).toBe("casa");
    expect(by.porcionar.windowKind).toBe("casa");
    expect(by.comprar.end <= by.cozinhar.start).toBe(true);
    expect(by.cozinhar.end <= by.porcionar.start).toBe(true);
  });

  it("prazo rígido impossível vira 'não coube' com motivo", () => {
    const r = schedule(
      base({ tasks: [task({ id: "x", durationMin: 120, location: "casa", deadline: "2026-10-13T12:00:00-03:00" })] }),
    );
    expect(r.blocks).toEqual([]);
    expect(r.unplaced[0].reason).toMatch(/prazo|livre/i);
  });

  it("respeita blocos já ocupados e o intervalo entre tarefas", () => {
    const r = schedule(
      base({
        busy: [{ id: "b", taskId: "t0", start: "2026-10-12T16:00:00-03:00", end: "2026-10-12T17:00:00-03:00", windowKind: "fora" }],
        tasks: [task({ id: "cabelo", durationMin: 45, location: "rua" })],
      }),
    );
    expect(r.blocks[0].start).toBe("2026-10-12T17:10:00-03:00");
  });

  it("sexta sem faculdade: tarefa de rua em Santos atrasa a chegada em casa", () => {
    const fri = "2026-10-16T16:00:00-03:00";
    const r = schedule(
      base({
        tasks: [
          task({ id: "mercado", durationMin: 45, location: "rua", region: "Santos", earliestStart: fri, deadline: "2026-10-16T18:00:00-03:00" }),
          task({ id: "arrumar", durationMin: 60, location: "casa", earliestStart: fri, deadline: "2026-10-16T23:59:00-03:00" }),
        ],
      }),
    );
    const by = Object.fromEntries(r.blocks.map((b) => [b.taskId, b]));
    expect(by.mercado.start).toBe("2026-10-16T16:00:00-03:00");
    // 16:45 + 1h de volta = 17:45
    expect(by.arrumar.start >= "2026-10-16T17:45:00-03:00").toBe(true);
    expect(by.arrumar.windowKind).toBe("casa");
  });

  it("divide tarefa longa divisível (TCC 5h)", () => {
    const r = schedule(base({ tasks: [task({ id: "tcc", durationMin: 300, splittable: true, minChunkMin: 60, deadline: "2026-10-15T23:59:00-03:00" })] }));
    expect(r.unplaced).toEqual([]);
    const total = r.blocks.reduce((a, b) => a + (Date.parse(b.end) - Date.parse(b.start)) / 60000, 0);
    expect(total).toBe(300);
    expect(r.blocks.length).toBeGreaterThan(1);
  });

  it("depois do último compromisso fora, prefere ir para casa a ficar horas em Santos", () => {
    const fri = "2026-10-16T16:00:00-03:00";
    const r = schedule(base({ tasks: [task({ id: "estudar", durationMin: 180, earliestStart: fri, deadline: "2026-10-16T23:59:00-03:00" })] }));
    expect(r.blocks[0].windowKind).toBe("casa");
  });

  it("horários diferentes por dia: sexta acorda 9h e dorme 2h", () => {
    const s = { ...base().settings, quietStart: null, dayTimes: { 5: { wake: "09:00", sleep: "02:00" } } };
    const tl = dayTimeline("2026-10-16", base({ settings: s }));
    expect(hm(tl[0].start)).toBe("09:00"); // acorda 9h → já sai atrasado para o estágio
    const last = tl[tl.length - 1];
    expect(last.end).toBe("2026-10-17T02:00:00-03:00");
    // outros dias seguem o padrão
    expect(hm(dayTimeline("2026-10-12", base({ settings: s }))[0].start)).toBe("07:00");
  });

  it("sem horário fixo usa a referência geral", () => {
    const s = { ...base().settings, wakeTime: "08:00", dayTimes: { 6: { wake: null, sleep: null } } };
    const tl = dayTimeline("2026-10-17", base({ settings: s }));
    expect(tl.map((x) => `${hm(x.start)}-${hm(x.end)}`)).toEqual(["08:00-00:00"]);
  });

  it("nada depois do início do silêncio (00h)", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task({ id: `t${i}`, durationMin: 60, location: "qualquer" }));
    const r = schedule(base({ tasks }));
    for (const b of r.blocks) {
      const end = hm(b.end);
      expect(end === "00:00" || end >= "07:00").toBe(true);
    }
  });

  it("é determinístico", () => {
    const input = base({
      tasks: [
        task({ id: "a", durationMin: 30, priority: 4 }),
        task({ id: "b", durationMin: 90, location: "casa" }),
        task({ id: "c", durationMin: 45, location: "rua" }),
      ],
    });
    expect(schedule(input)).toEqual(schedule(input));
  });
});

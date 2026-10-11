// Contrato da interpretação: schema pedido ao LLM, prompt e validação da saída.

export const CATEGORIES = ["pessoal", "faculdade", "tcc", "empresa_junior", "trabalho"] as const;
export const LOCATIONS = ["casa", "rua", "qualquer"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Location = (typeof LOCATIONS)[number];

export interface ParsedSubtask {
  title: string;
  duration_min: number;
  location: Location;
  region: string | null;
}

export interface ParsedTask {
  title: string;
  category: Category;
  duration_min: number;
  deadline: string | null;
  deadline_hard: boolean;
  earliest_start: string | null;
  priority: number;
  location: Location;
  region: string | null;
  is_cooking: boolean;
  inferred: boolean;
  splittable: boolean;
  notes: string | null;
  subtasks: ParsedSubtask[];
}

export interface ParsedEvent {
  title: string;
  date: string;
  start: string | null;
  end: string | null;
  category: Category;
  location_text: string | null;
}

export interface Interpretation {
  events: ParsedEvent[];
  tasks: ParsedTask[];
  questions: string[];
}

export interface InterpretContext {
  now: string; // ISO com fuso
  timezone: string;
  regions: string[]; // ex.: ["Praia Grande", "Santos"]
  homeRegion: string | null;
  routine: string; // resumo da rotina fixa em texto
}

const str = { type: "string" };
const nstr = (description?: string) => ({ type: "string", nullable: true, ...(description ? { description } : {}) });

export const INTERPRETATION_SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: str,
          date: { type: "string", description: "YYYY-MM-DD" },
          start: nstr("HH:MM ou null se não houver horário"),
          end: nstr("HH:MM ou null"),
          category: { type: "string", enum: [...CATEGORIES] },
          location_text: nstr(),
        },
        required: ["title", "date", "start", "end", "category", "location_text"],
      },
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: str,
          category: { type: "string", enum: [...CATEGORIES] },
          duration_min: { type: "integer" },
          deadline: nstr("ISO 8601 com fuso, ex.: 2026-10-15T08:00:00-03:00"),
          deadline_hard: { type: "boolean" },
          earliest_start: nstr("ISO 8601 com fuso"),
          priority: { type: "integer", description: "1 baixa, 2 normal, 3 alta, 4 urgente" },
          location: { type: "string", enum: [...LOCATIONS] },
          region: nstr("cidade onde precisa ser feita (só para location=rua)"),
          is_cooking: { type: "boolean" },
          inferred: { type: "boolean" },
          splittable: { type: "boolean" },
          notes: nstr(),
          subtasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: str,
                duration_min: { type: "integer" },
                location: { type: "string", enum: [...LOCATIONS] },
                region: nstr(),
              },
              required: ["title", "duration_min", "location", "region"],
            },
          },
        },
        required: [
          "title", "category", "duration_min", "deadline", "deadline_hard", "earliest_start", "priority",
          "location", "region", "is_cooking", "inferred", "splittable", "notes", "subtasks",
        ],
      },
    },
    questions: { type: "array", items: str },
  },
  required: ["events", "tasks", "questions"],
};

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function buildPrompt(text: string, ctx: InterpretContext): { system: string; user: string } {
  const wd = WEEKDAYS[new Date(ctx.now.slice(0, 10) + "T12:00:00Z").getUTCDay()];
  const system = `Você organiza a semana de um estudante que também estagia. Converta o texto livre (pt-BR, falado ou digitado, informal) em JSON seguindo o schema. Você NÃO escolhe horários para as tarefas: só descreve o que precisa ser feito. Um agendador separado encaixa as tarefas.

Regras:
- "events": compromissos com dia marcado em que a pessoa só comparece (prova, consulta já marcada, reunião). Sem horário dito: start e end null. Não invente horários.
- "tasks": coisas que a pessoa precisa FAZER. Uma tarefa por objetivo.
- Tarefas com várias etapas viram subtasks em ordem de execução. Ex.: marmita/refeições da semana → comprar ingredientes (rua) → cozinhar (casa) → porcionar (casa). Nesse caso, duration_min = soma das subtasks.
- duration_min realista, em múltiplos de 5, entre 5 e 600.
- location: "casa" se só dá para fazer em casa (cozinhar, arrumar, lavar roupa, faxina); "rua" se exige sair (mercado, médico, cabelo, banco, farmácia, buscar algo); "qualquer" se dá para fazer em qualquer lugar (estudar, ler, ligar, e-mail, computador).
- region: só para location "rua" e SOMENTE se o próprio texto citar a cidade (regiões conhecidas: ${ctx.regions.join(", ") || "nenhuma"}). Nunca deduza a região pela casa ou pela rotina. Na dúvida, null.
- category: pessoal, faculdade, tcc, empresa_junior ou trabalho (estágio).
- deadline: ISO 8601 com o fuso do usuário. "quinta tenho prova" → a preparação termina antes do dia da prova. Comida "pra semana" sem dia dito → deadline null e priority 3 (o agendador faz o quanto antes). Sem prazo: null. Nunca use um prazo no passado nem no mesmo dia, a menos que o texto diga "hoje".
- earliest_start: só se o texto disser que não dá para começar antes de algo ("depois de sexta"). Senão null.
- deadline_hard: true quando perder o prazo tem consequência real (prova, entrega); false quando é preferência.
- priority: 1 baixa, 2 normal, 3 alta, 4 urgente (prazo nas próximas 48 h e importante).
- is_cooking: true para preparo de comida.
- splittable: true para trabalho longo que pode ser feito em partes (estudar, escrever TCC); false para o resto.
- inferred: true SÓ para tarefas que a pessoa não pediu mas fazem sentido (ex.: "estudar para a prova" quando ela só disse que tem prova). Seja comedido: no máximo uma por compromisso.
- questions: dúvidas importantes que impediram de entender algo; normalmente vazio.
- Títulos curtos em português, começando com verbo quando for tarefa.`;

  const user = `Agora: ${ctx.now} (${wd}, fuso ${ctx.timezone}).
Casa fica em: ${ctx.homeRegion ?? "não informado"}.
Rotina fixa:
${ctx.routine || "(não informada)"}

Texto:
"""${text.trim()}"""`;
  return { system, user };
}

// ---------------------------------------------------------------------------
// validação: corrige o que der e rejeita o que não der
// ---------------------------------------------------------------------------

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
};
const roundTo5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
const oneOf = <T extends string>(v: unknown, opts: readonly T[], dflt: T): T =>
  (opts as readonly string[]).includes(v as string) ? (v as T) : dflt;
const text = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const isoOrNull = (v: unknown): string | null => {
  if (typeof v !== "string" || !v) return null;
  return Number.isNaN(Date.parse(v)) ? null : v;
};
const hhmm = (v: unknown): string | null =>
  typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;

export class InvalidInterpretation extends Error {}

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** `sourceText`: texto original, para descartar regiões que o LLM inventou. */
export function validateInterpretation(raw: unknown, sourceText?: string): Interpretation {
  const said = sourceText ? normalize(sourceText) : null;
  const regionIfSaid = (v: unknown): string | null => {
    const r = text(v, 80);
    if (!r || said === null) return r;
    return said.includes(normalize(r)) ? r : null;
  };
  if (!raw || typeof raw !== "object") throw new InvalidInterpretation("resposta não é um objeto");
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.tasks) || !Array.isArray(r.events)) {
    throw new InvalidInterpretation("faltam as listas tasks/events");
  }

  const events: ParsedEvent[] = [];
  for (const e of r.events as Record<string, unknown>[]) {
    const title = text(e?.title);
    const date = typeof e?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : null;
    if (!title || !date) continue;
    events.push({
      title,
      date,
      start: hhmm(e.start),
      end: hhmm(e.end),
      category: oneOf(e.category, CATEGORIES, "pessoal"),
      location_text: text(e.location_text),
    });
  }

  const tasks: ParsedTask[] = [];
  for (const t of r.tasks as Record<string, unknown>[]) {
    const title = text(t?.title);
    if (!title) continue;
    const subtasks: ParsedSubtask[] = [];
    if (Array.isArray(t.subtasks)) {
      for (const s of t.subtasks as Record<string, unknown>[]) {
        const st = text(s?.title);
        if (!st) continue;
        const loc = oneOf(s.location, LOCATIONS, "qualquer");
        subtasks.push({
          title: st,
          duration_min: roundTo5(clampInt(s.duration_min, 5, 600, 30)),
          location: loc,
          region: loc === "rua" ? regionIfSaid(s.region) : null,
        });
      }
    }
    const location = oneOf(t.location, LOCATIONS, "qualquer");
    const dur = subtasks.length
      ? subtasks.reduce((a, s) => a + s.duration_min, 0)
      : roundTo5(clampInt(t.duration_min, 5, 600, 30));
    tasks.push({
      title,
      category: oneOf(t.category, CATEGORIES, "pessoal"),
      duration_min: dur,
      deadline: isoOrNull(t.deadline),
      deadline_hard: t.deadline_hard !== false,
      earliest_start: isoOrNull(t.earliest_start),
      priority: clampInt(t.priority, 1, 4, 2),
      location,
      region: location === "rua" ? regionIfSaid(t.region) : null,
      is_cooking: t.is_cooking === true,
      inferred: t.inferred === true,
      splittable: t.splittable === true && subtasks.length === 0,
      notes: text(t.notes, 500),
      subtasks,
    });
  }

  if (!tasks.length && !events.length && !(Array.isArray(r.questions) && r.questions.length)) {
    throw new InvalidInterpretation("nada foi reconhecido no texto");
  }
  const questions = Array.isArray(r.questions)
    ? (r.questions as unknown[]).map((q) => text(q, 300)).filter((q): q is string => !!q)
    : [];
  return { events, tasks, questions };
}

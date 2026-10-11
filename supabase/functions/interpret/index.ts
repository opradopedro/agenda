// POST /functions/v1/interpret  { text, context } → { interpretation, model }
// Fase 1: sem login (verify_jwt desligado); o teto diário protege a cota do Gemini.
// Fase 2: passa a exigir o JWT do usuário.
import { createLLM, LLMError } from "../_shared/llm/index.ts";
import {
  buildPrompt,
  INTERPRETATION_SCHEMA,
  type InterpretContext,
  InvalidInterpretation,
  validateInterpretation,
} from "../_shared/interpret/contract.ts";
import { countToday, logUsage } from "../_shared/usage.ts";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

type Env = (k: string) => string | undefined;

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "use POST" });

  let body: { text?: unknown; context?: Partial<InterpretContext> };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "JSON inválido" });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return json(400, { error: "texto vazio" });
  if (text.length > 4000) return json(400, { error: "texto longo demais (máx. 4000 caracteres)" });

  const c = body.context ?? {};
  const ctx: InterpretContext = {
    now: typeof c.now === "string" && !Number.isNaN(Date.parse(c.now)) ? c.now : new Date().toISOString(),
    timezone: typeof c.timezone === "string" ? c.timezone : "America/Sao_Paulo",
    regions: Array.isArray(c.regions) ? c.regions.filter((r) => typeof r === "string").slice(0, 10) : [],
    homeRegion: typeof c.homeRegion === "string" ? c.homeRegion : null,
    routine: typeof c.routine === "string" ? c.routine.slice(0, 3000) : "",
  };

  const cap = Number(env("LLM_DAILY_CAP") ?? "200");
  const used = await countToday(env);
  if (used !== null && used >= cap) {
    return json(429, { error: `Limite diário de ${cap} interpretações atingido. Tente amanhã ou aumente LLM_DAILY_CAP.` });
  }

  let llm;
  try {
    llm = createLLM(env);
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }

  const prompt = buildPrompt(text, ctx);
  const log = (r: { model: string; ok: boolean; error?: string; usage?: { inputTokens: number; outputTokens: number } }) =>
    logUsage(env, { fn: "interpret", provider: llm.provider, ...r });

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const user = attempt === 0 ? prompt.user : `${prompt.user}\n\nSua resposta anterior foi rejeitada: ${lastError}. Responda de novo seguindo o schema.`;
      const r = await llm.generateJSON<unknown>(
        { system: prompt.system, user, jsonSchema: INTERPRETATION_SCHEMA, temperature: 0.2 },
        log,
      );
      const interpretation = validateInterpretation(r.data, text);
      return json(200, { interpretation, model: r.model });
    } catch (e) {
      if (e instanceof InvalidInterpretation) {
        lastError = e.message;
        continue;
      }
      if (e instanceof LLMError && e.kind === "quota") {
        return json(429, { error: "A cota gratuita do Gemini acabou por hoje. Tente mais tarde." });
      }
      if (e instanceof LLMError && e.kind === "timeout") {
        return json(504, { error: "A IA demorou demais para responder. Tente de novo." });
      }
      return json(502, { error: `Falha na IA: ${(e as Error).message}` });
    }
  }
  return json(422, { error: `Não consegui entender o texto (${lastError}).` });
}

if (import.meta.main) {
  Deno.serve((req) => handle(req, (k) => Deno.env.get(k)));
}

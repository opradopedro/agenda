// POST /functions/v1/cook  { request, servings, preferences, count } → { recipes, model }
import { createLLM, LLMError } from "../_shared/llm/index.ts";
import { buildCookPrompt, COOK_SCHEMA, validateRecipes } from "../_shared/cook/contract.ts";
import { countToday, logUsage } from "../_shared/usage.ts";
import { authorize, CORS, json } from "../_shared/http.ts";

type Env = (k: string) => string | undefined;

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "use POST" });
  const auth = await authorize(req, env);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "JSON inválido" });
  }
  const request = typeof body.request === "string" ? body.request.trim().slice(0, 500) : "";
  if (!request) return json(400, { error: "pedido vazio" });
  const servings = Math.min(30, Math.max(1, Math.round(Number(body.servings) || 5)));
  const preferences = typeof body.preferences === "string" ? body.preferences.slice(0, 500) : "";
  const count = Math.min(5, Math.max(1, Math.round(Number(body.count) || 3)));

  const cap = Number(env("LLM_DAILY_CAP") ?? "200");
  const used = await countToday(env);
  if (used !== null && used >= cap) return json(429, { error: `Limite diário de ${cap} chamadas à IA atingido.` });

  let llm;
  try {
    llm = createLLM(env);
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
  const prompt = buildCookPrompt({ request, servings, preferences, count });
  try {
    const r = await llm.generateJSON<unknown>(
      { system: prompt.system, user: prompt.user, jsonSchema: COOK_SCHEMA, temperature: 0.7, timeoutMs: 45000 },
      (a) => logUsage(env, { fn: "cook", provider: llm.provider, userId: auth.userId, ...a }),
    );
    return json(200, { recipes: validateRecipes(r.data), model: r.model });
  } catch (e) {
    if (e instanceof LLMError && e.kind === "quota") return json(429, { error: "A cota gratuita do Gemini acabou por hoje." });
    if (e instanceof LLMError && e.kind === "timeout") return json(504, { error: "A IA demorou demais. Tente de novo." });
    return json(502, { error: `Falha ao sugerir receitas: ${(e as Error).message}` });
  }
}

if (import.meta.main) {
  Deno.serve((req) => handle(req, (k) => Deno.env.get(k)));
}

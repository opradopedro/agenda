import type { InterpretContext, Interpretation } from "@shared/interpret/contract.ts";
import type { SuggestedRecipe } from "@shared/cook/contract.ts";

const URL_BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export class ApiError extends Error {}

/** Token da sessão (Fase 2). Sem login, as funções usam o modo anônimo. */
let tokenProvider: () => Promise<string | null> = async () => null;
export const setTokenProvider = (fn: () => Promise<string | null>) => (tokenProvider = fn);

export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  if (!URL_BASE) throw new ApiError("App sem VITE_SUPABASE_URL configurada");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ANON) headers.apikey = ANON;
  const token = await tokenProvider();
  if (token) headers.authorization = `Bearer ${token}`;
  else if (ANON && ANON.split(".").length === 3) headers.authorization = `Bearer ${ANON}`;
  let res: Response;
  try {
    res = await fetch(`${URL_BASE}/functions/v1/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw new ApiError("Sem conexão com a internet.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error ?? `Erro ${res.status}`);
  return data as T;
}

export async function interpret(text: string, context: InterpretContext): Promise<{ interpretation: Interpretation; model: string }> {
  try {
    return await callFunction("interpret", { text, context });
  } catch (e) {
    if ((e as Error).message === "Sem conexão com a internet.") {
      throw new ApiError("Sem conexão. A captura ficou salva na Caixa de entrada para tentar de novo.");
    }
    throw e;
  }
}

export const suggestRecipes = (request: string, servings: number, preferences: string) =>
  callFunction<{ recipes: SuggestedRecipe[]; model: string }>("cook", { request, servings, preferences, count: 3 });

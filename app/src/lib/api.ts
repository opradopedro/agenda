import type { InterpretContext, Interpretation } from "@shared/interpret/contract.ts";

const URL_BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export class ApiError extends Error {}

export async function interpret(text: string, context: InterpretContext): Promise<{ interpretation: Interpretation; model: string }> {
  if (!URL_BASE) throw new ApiError("App sem VITE_SUPABASE_URL configurada");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ANON) {
    headers.apikey = ANON;
    if (ANON.split(".").length === 3) headers.authorization = `Bearer ${ANON}`;
  }
  let res: Response;
  try {
    res = await fetch(`${URL_BASE}/functions/v1/interpret`, { method: "POST", headers, body: JSON.stringify({ text, context }) });
  } catch {
    throw new ApiError("Sem conexão. A captura ficou salva na Caixa de entrada para tentar de novo.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body?.error ?? `Erro ${res.status} na interpretação`);
  return body;
}

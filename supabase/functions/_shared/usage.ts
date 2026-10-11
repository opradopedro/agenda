// Registro de uso da IA em public.llm_usage (best-effort: se a tabela ainda
// não existir, nada quebra). Usa a service role disponível nas Edge Functions.
type Env = (k: string) => string | undefined;

function rest(env: Env) {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return { url: `${url}/rest/v1/llm_usage`, headers: { apikey: key, authorization: `Bearer ${key}` } };
}

/** Início do dia de hoje em America/Sao_Paulo (UTC−3, sem horário de verão). */
function startOfTodayBr(): string {
  const now = new Date(Date.now() - 3 * 3600_000);
  return `${now.toISOString().slice(0, 10)}T00:00:00-03:00`;
}

export async function countToday(env: Env): Promise<number | null> {
  const r = rest(env);
  if (!r) return null;
  try {
    const res = await fetch(
      `${r.url}?select=id&ok=eq.true&created_at=gte.${encodeURIComponent(startOfTodayBr())}`,
      { headers: { ...r.headers, prefer: "count=exact", range: "0-0" } },
    );
    if (!res.ok) return null;
    const total = res.headers.get("content-range")?.split("/")[1];
    return total && total !== "*" ? Number(total) : null;
  } catch {
    return null;
  }
}

export async function logUsage(
  env: Env,
  u: { fn: string; provider: string; model: string; ok: boolean; error?: string; usage?: { inputTokens: number; outputTokens: number } },
): Promise<void> {
  const r = rest(env);
  if (!r) return;
  try {
    await fetch(r.url, {
      method: "POST",
      headers: { ...r.headers, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({
        fn: u.fn,
        provider: u.provider,
        model: u.model,
        ok: u.ok,
        error: u.error?.slice(0, 500) ?? null,
        input_tokens: u.usage?.inputTokens ?? null,
        output_tokens: u.usage?.outputTokens ?? null,
      }),
    });
  } catch {
    // ignora: registro de uso não pode derrubar a interpretação
  }
}

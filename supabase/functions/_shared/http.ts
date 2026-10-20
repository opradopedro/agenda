// CORS, respostas JSON e autorização comuns às Edge Functions.
type Env = (k: string) => string | undefined;

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export type Auth =
  | { ok: true; userId: string | null; email: string | null; token: string | null }
  | { ok: false; status: number; error: string };

/**
 * Usuário logado: valida o JWT no Supabase Auth e confere ALLOWED_EMAILS.
 * Sem login: só passa enquanto ALLOW_ANON não for "false" (modo da Fase 1).
 */
export async function authorize(req: Request, env: Env): Promise<Auth> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = token ? jwtPayload(token) : null;
  if (payload?.role === "authenticated") {
    const url = env("SUPABASE_URL");
    const anon = env("SUPABASE_ANON_KEY") ?? "";
    const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${token}` } });
    if (!res.ok) return { ok: false, status: 401, error: "Sessão expirada. Entre de novo." };
    const user = await res.json();
    const allowed = (env("ALLOWED_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.includes(String(user.email ?? "").toLowerCase())) {
      return { ok: false, status: 403, error: "Esta conta não tem acesso." };
    }
    return { ok: true, userId: user.id, email: user.email ?? null, token };
  }
  if (env("ALLOW_ANON") === "false") return { ok: false, status: 401, error: "Entre com sua conta Google para usar a IA." };
  return { ok: true, userId: null, email: null, token: null };
}

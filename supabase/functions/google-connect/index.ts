// POST { refresh_token, scopes? }  → guarda o refresh token do Google no Vault
// POST { disconnect: true }        → esquece a conexão
import { Rest } from "../_shared/admin.ts";
import { authorize, CORS, json } from "../_shared/http.ts";

type Env = (k: string) => string | undefined;

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "use POST" });
  const auth = await authorize(req, env);
  if (!auth.ok) return json(auth.status, { error: auth.error });
  if (!auth.userId) return json(401, { error: "Entre com sua conta Google." });
  const body = await req.json().catch(() => ({}));
  const rest = new Rest(env);
  if (body.disconnect) {
    await rest.rpc("forget_google", { p_user: auth.userId });
    return json(200, { connected: false });
  }
  if (typeof body.refresh_token !== "string" || body.refresh_token.length < 10) {
    return json(400, { error: "refresh_token ausente" });
  }
  await rest.rpc("store_google_refresh_token", {
    p_user: auth.userId,
    p_token: body.refresh_token,
    p_scopes: Array.isArray(body.scopes) ? body.scopes.filter((s: unknown) => typeof s === "string") : null,
  });
  return json(200, { connected: true });
}

if (import.meta.main) {
  Deno.serve((req) => handle(req, (k) => Deno.env.get(k)));
}

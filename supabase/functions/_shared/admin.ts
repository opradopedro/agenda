// Acesso ao banco com a service role (só dentro das Edge Functions).
type Env = (k: string) => string | undefined;

export class Rest {
  private base: string;
  private headers: Record<string, string>;
  constructor(env: Env) {
    const url = env("SUPABASE_URL");
    const key = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes");
    this.base = `${url}/rest/v1`;
    this.headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
  }

  private async req<T>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { ...this.headers };
    if (init.prefer) headers.prefer = init.prefer;
    const res = await fetch(`${this.base}${path}`, { ...init, headers });
    const text = await res.text();
    if (!res.ok) throw new Error(`REST ${init.method ?? "GET"} ${path.split("?")[0]}: ${res.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  get<T>(table: string, query: string): Promise<T[]> {
    return this.req<T[]>(`/${table}?${query}`);
  }
  insert<T>(table: string, rows: unknown, opts: { ignoreDuplicates?: boolean; onConflict?: string } = {}): Promise<T[]> {
    const q = opts.onConflict ? `?on_conflict=${opts.onConflict}` : "";
    return this.req<T[]>(`/${table}${q}`, {
      method: "POST",
      body: JSON.stringify(rows),
      prefer: `return=representation${opts.ignoreDuplicates ? ",resolution=ignore-duplicates" : ""}`,
    });
  }
  patch(table: string, query: string, values: unknown): Promise<null> {
    return this.req<null>(`/${table}?${query}`, { method: "PATCH", body: JSON.stringify(values), prefer: "return=minimal" });
  }
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    return this.req<T>(`/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
  }
}

/** Chamada do pg_cron: confere o segredo guardado no Vault. */
export async function isCron(req: Request, rest: Rest): Promise<boolean> {
  const s = req.headers.get("x-cron-secret");
  if (!s) return false;
  return (await rest.rpc<boolean>("check_cron_secret", { p_secret: s })) === true;
}

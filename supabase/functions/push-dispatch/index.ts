// Web Push (computador). Roda a cada minuto pelo pg_cron: para cada bloco que
// começa ou termina agora, manda uma notificação (uma só por bloco e tipo,
// garantida pela tabela notification_jobs). Respeita silêncio, tipos ligados e
// o aviso escolhido na tarefa.
// POST { test: true } com o JWT do usuário manda uma notificação de teste.
import webpush from "npm:web-push@3.6.7";
import { isCron, Rest } from "../_shared/admin.ts";
import { authorize, CORS, json } from "../_shared/http.ts";
import { type AppSettings, type BlockRow, dueMessages, type PushMessage, type TaskRow } from "../_shared/push/messages.ts";

type Env = (k: string) => string | undefined;

interface Device {
  id: string;
  user_id: string;
  push_endpoint: string;
  push_p256dh: string;
  push_auth: string;
}
async function send(rest: Rest, devices: Device[], msg: PushMessage): Promise<number> {
  let ok = 0;
  for (const d of devices) {
    try {
      // web-push monta e criptografa (VAPID + aes128gcm); o envio é pelo fetch do Deno
      const r = webpush.generateRequestDetails(
        { endpoint: d.push_endpoint, keys: { p256dh: d.push_p256dh, auth: d.push_auth } },
        JSON.stringify(msg),
        { TTL: 600, urgency: msg.kind === "teste" ? "normal" : "high" },
      );
      const res = await fetch(r.endpoint, { method: r.method, headers: r.headers as Record<string, string>, body: r.body as unknown as BodyInit });
      if (res.ok) ok++;
      else if (res.status === 404 || res.status === 410) await rest.patch("devices", `id=eq.${d.id}`, { deleted_at: new Date().toISOString() });
      else console.warn("push recusado", res.status, await res.text());
    } catch (e) {
      console.warn("push falhou", (e as Error).message);
    }
  }
  return ok;
}

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "use POST" });
  const pub = env("VAPID_PUBLIC_KEY");
  const priv = env("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return json(500, { error: "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas" });
  webpush.setVapidDetails(env("VAPID_SUBJECT") ?? "mailto:agenda@example.com", pub, priv);
  const base = env("APP_URL") ?? "https://opradopedro.github.io/agenda/";
  const rest = new Rest(env);
  const body = await req.json().catch(() => ({}));

  if (!(await isCron(req, rest))) {
    // teste a pedido do usuário
    const auth = await authorize(req, env);
    if (!auth.ok) return json(auth.status, { error: auth.error });
    if (!auth.userId || !body.test) return json(400, { error: "use { test: true } logado" });
    const devices = await rest.get<Device>("devices", `user_id=eq.${auth.userId}&platform=eq.web&notifications_enabled=is.true&deleted_at=is.null`);
    const sent = await send(rest, devices, {
      kind: "teste",
      tag: "agenda",
      title: "Notificações funcionando",
      body: "É assim que o Agenda IA vai te avisar neste computador.",
      url: base,
      silent: false,
      requireInteraction: false,
      actions: [],
    });
    return json(200, { devices: devices.length, sent });
  }

  const devices = await rest.get<Device>("devices", "platform=eq.web&notifications_enabled=is.true&deleted_at=is.null");
  const users = [...new Set(devices.map((d) => d.user_id))];
  const now = Date.now();
  let sent = 0;
  for (const u of users) {
    const [profile] = await rest.get<{ app_settings: AppSettings | null }>("profiles", `user_id=eq.${u}&select=app_settings`);
    const s = profile?.app_settings ?? {};
    const lead = Number(s.reminderLeadMin ?? 0);
    const from = new Date(now - 3 * 60000).toISOString();
    const to = new Date(now + (lead + 3) * 60000).toISOString();
    const blocks = await rest.get<BlockRow>(
      "schedule_blocks",
      `user_id=eq.${u}&status=in.(confirmado,em_andamento)&deleted_at=is.null&or=(start_at.gte.${from},end_at.gte.${from})&start_at=lte.${to}&select=id,task_id,start_at,end_at,region,window_kind`,
    );
    if (!blocks.length) continue;
    const ids = [...new Set(blocks.map((b) => b.task_id))];
    const tasks = await rest.get<TaskRow>("tasks", `id=in.(${ids.join(",")})&select=id,title,alert_mode,parent_id`);
    const parentIds = tasks.map((t) => t.parent_id).filter(Boolean);
    const parents = parentIds.length ? await rest.get<TaskRow>("tasks", `id=in.(${parentIds.join(",")})&select=id,title,alert_mode,parent_id`) : [];
    const msgs = dueMessages(now, blocks, new Map([...tasks, ...parents].map((t) => [t.id, t])), s, base);
    for (const m of msgs) {
      // uma notificação por bloco, tipo e horário (o cron pode rodar duas vezes;
      // "mais tempo" muda o horário do fim e gera um novo aviso)
      const claimed = await rest.insert(
        "notification_jobs",
        [{ user_id: u, block_id: m.blockId, kind: m.kind, fire_at: m.fireAt, status: "enviada", sent_at: new Date().toISOString() }],
        { ignoreDuplicates: true, onConflict: "block_id,kind,fire_at" },
      );
      if (!claimed.length) continue;
      sent += await send(rest, devices.filter((d) => d.user_id === u), m);
    }
  }
  return json(200, { users: users.length, sent });
}

if (import.meta.main) {
  Deno.serve((req) => handle(req, (k) => Deno.env.get(k)));
}

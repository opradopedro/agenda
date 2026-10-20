// Sincroniza com o Google Calendar.
//   Escrita: blocos confirmados → calendário "Agenda IA" (sem lembretes, salvo opção).
//   Leitura: eventos dos calendários escolhidos → tabela events (compromissos fixos).
// Chamada pelo app (JWT do usuário) ou pelo pg_cron (x-cron-secret, todos os usuários).
import { isCron, Rest } from "../_shared/admin.ts";
import { authorize, CORS, json } from "../_shared/http.ts";
import { localToMin, minToIso } from "../_shared/scheduler/time.ts";

type Env = (k: string) => string | undefined;

interface Profile {
  user_id: string;
  gcal_calendar_id: string | null;
  app_settings: Record<string, unknown> | null;
}
interface BlockRow {
  id: string;
  task_id: string;
  start_at: string;
  end_at: string;
  status: string;
  region: string | null;
  gcal_event_id: string | null;
  gcal_synced_at: string | null;
  updated_at: string;
  deleted_at: string | null;
}
interface TaskRow {
  id: string;
  title: string;
  category: string;
  parent_id: string | null;
}
interface EventRow {
  id: string;
  gcal_calendar_id: string;
  gcal_event_id: string;
  gcal_etag: string | null;
  start_at: string;
  end_at: string;
  deleted_at: string | null;
}
interface GEvent {
  id: string;
  etag: string;
  status: string;
  summary?: string;
  location?: string;
  transparency?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
}

const ACTIVE = new Set(["confirmado", "em_andamento", "concluido"]);
const CATEGORY = { pessoal: "Pessoal", faculdade: "Faculdade", tcc: "TCC", empresa_junior: "Empresa Jr.", trabalho: "Trabalho" } as Record<string, string>;
// cores do Google Calendar (1–11) por categoria
const COLOR = { pessoal: "10", faculdade: "9", tcc: "3", empresa_junior: "6", trabalho: "8" } as Record<string, string>;

class Google {
  constructor(private token: string, private base: string) {}
  async call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok && ![404, 410].includes(res.status)) {
      throw new Error(`Google ${method} ${path.split("?")[0]}: ${res.status} ${text.slice(0, 200)}`);
    }
    return { status: res.status, data };
  }
}

async function accessToken(env: Env, refresh: string): Promise<string> {
  const res = await fetch(env("GOOGLE_TOKEN_URL") ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID") ?? "",
      client_secret: env("GOOGLE_CLIENT_SECRET") ?? "",
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`token do Google recusado (${data.error ?? res.status}). Reconecte a conta.`);
  return data.access_token;
}

function eventBody(b: BlockRow, task: TaskRow | undefined, parent: TaskRow | undefined, tz: string, reminders: boolean, lead: number) {
  return {
    summary: task?.title ?? "Tarefa",
    description: [parent ? `Etapa de: ${parent.title}` : null, task ? CATEGORY[task.category] : null, "Criado pelo Agenda IA"].filter(Boolean).join("\n"),
    location: b.region ?? undefined,
    start: { dateTime: b.start_at, timeZone: tz },
    end: { dateTime: b.end_at, timeZone: tz },
    colorId: task ? COLOR[task.category] : undefined,
    transparency: "opaque",
    reminders: reminders ? { useDefault: false, overrides: [{ method: "popup", minutes: lead }] } : { useDefault: false, overrides: [] },
    extendedProperties: { private: { agendaBlockId: b.id } },
  };
}

/** Converte data de dia inteiro do Google (YYYY-MM-DD) para instante no fuso. */
const dayStart = (date: string, tz: string) => minToIso(localToMin(date, 0, tz), tz);

export async function syncUser(env: Env, rest: Rest, userId: string): Promise<Record<string, number>> {
  const stats = { created: 0, updated: 0, deleted: 0, read: 0, removed: 0 };
  const [profile] = await rest.get<Profile>("profiles", `user_id=eq.${userId}&select=user_id,gcal_calendar_id,app_settings`);
  const settings = (profile?.app_settings ?? {}) as Record<string, unknown>;
  const tz = (settings.timezone as string) ?? "America/Sao_Paulo";
  const horizon = Number(settings.horizonDays ?? 14);
  const refresh = await rest.rpc<string | null>("get_google_refresh_token", { p_user: userId });
  if (!refresh) return stats;
  const g = new Google(await accessToken(env, refresh), env("GOOGLE_API_BASE") ?? "https://www.googleapis.com/calendar/v3");

  // calendário "Agenda IA" (criado sem lembretes padrão)
  let calId = profile?.gcal_calendar_id ?? null;
  if (calId) {
    const r = await g.call("GET", `/calendars/${encodeURIComponent(calId)}`);
    if (r.status === 404 || r.status === 410) calId = null;
  }
  if (!calId) {
    const r = await g.call<{ id: string }>("POST", "/calendars", { summary: "Agenda IA", description: "Tarefas agendadas pelo Agenda IA", timeZone: tz });
    calId = r.data.id;
    await g.call("PATCH", `/users/me/calendarList/${encodeURIComponent(calId)}`, { defaultReminders: [] });
    await rest.patch("profiles", `user_id=eq.${userId}`, { gcal_calendar_id: calId });
  }
  const calPath = `/calendars/${encodeURIComponent(calId)}/events`;

  // ---- escrita: blocos → eventos
  const since = new Date(Date.now() - 86400000).toISOString();
  const blocks = await rest.get<BlockRow>(
    "schedule_blocks",
    `user_id=eq.${userId}&end_at=gte.${since}&select=id,task_id,start_at,end_at,status,region,gcal_event_id,gcal_synced_at,updated_at,deleted_at`,
  );
  const taskIds = [...new Set(blocks.map((b) => b.task_id))];
  const tasks = taskIds.length ? await rest.get<TaskRow>("tasks", `id=in.(${taskIds.join(",")})&select=id,title,category,parent_id`) : [];
  const parentIds = [...new Set(tasks.map((t) => t.parent_id).filter(Boolean))] as string[];
  const parents = parentIds.length ? await rest.get<TaskRow>("tasks", `id=in.(${parentIds.join(",")})&select=id,title,category,parent_id`) : [];
  const byId = new Map([...tasks, ...parents].map((t) => [t.id, t]));
  const reminders = settings.gcalReminders === true;
  const lead = Number(settings.reminderLeadMin ?? 10) || 10;

  for (const b of blocks) {
    const active = ACTIVE.has(b.status) && !b.deleted_at;
    const task = byId.get(b.task_id);
    const parent = task?.parent_id ? byId.get(task.parent_id) : undefined;
    const now = new Date().toISOString();
    if (active && !b.gcal_event_id) {
      const r = await g.call<{ id: string }>("POST", calPath, eventBody(b, task, parent, tz, reminders, lead));
      await rest.patch("schedule_blocks", `id=eq.${b.id}`, { gcal_event_id: r.data.id, gcal_synced_at: now });
      stats.created++;
    } else if (active && b.gcal_event_id && (!b.gcal_synced_at || Date.parse(b.updated_at) - Date.parse(b.gcal_synced_at) > 5000)) {
      const r = await g.call<{ id: string }>("PATCH", `${calPath}/${encodeURIComponent(b.gcal_event_id)}`, eventBody(b, task, parent, tz, reminders, lead));
      if (r.status === 404 || r.status === 410) {
        const c = await g.call<{ id: string }>("POST", calPath, eventBody(b, task, parent, tz, reminders, lead));
        await rest.patch("schedule_blocks", `id=eq.${b.id}`, { gcal_event_id: c.data.id, gcal_synced_at: now });
      } else {
        await rest.patch("schedule_blocks", `id=eq.${b.id}`, { gcal_synced_at: now });
      }
      stats.updated++;
    } else if (!active && b.gcal_event_id) {
      await g.call("DELETE", `${calPath}/${encodeURIComponent(b.gcal_event_id)}`);
      await rest.patch("schedule_blocks", `id=eq.${b.id}`, { gcal_event_id: null, gcal_synced_at: now });
      stats.deleted++;
    }
  }

  // ---- leitura: eventos dos outros calendários → compromissos
  const read = (Array.isArray(settings.gcalReadCalendarIds) && settings.gcalReadCalendarIds.length
    ? (settings.gcalReadCalendarIds as string[])
    : ["primary"]).filter((c) => c !== calId);
  const timeMin = new Date(Date.now() - 86400000).toISOString();
  const timeMax = new Date(Date.now() + horizon * 86400000).toISOString();
  const existing = await rest.get<EventRow>(
    "events",
    `user_id=eq.${userId}&source=eq.gcal&select=id,gcal_calendar_id,gcal_event_id,gcal_etag,start_at,end_at,deleted_at`,
  );
  const known = new Map(existing.map((e) => [`${e.gcal_calendar_id}|${e.gcal_event_id}`, e]));
  const seen = new Set<string>();
  for (const cal of read) {
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", showDeleted: "true", maxResults: "250", ...(pageToken ? { pageToken } : {}) });
      const r = await g.call<{ items?: GEvent[]; nextPageToken?: string }>("GET", `/calendars/${encodeURIComponent(cal)}/events?${q}`);
      if (r.status === 404) break;
      for (const ev of r.data.items ?? []) {
        const key = `${cal}|${ev.id}`;
        seen.add(key);
        const cur = known.get(key);
        if (ev.status === "cancelled") {
          if (cur && !cur.deleted_at) {
            await rest.patch("events", `id=eq.${cur.id}`, { deleted_at: new Date().toISOString() });
            stats.removed++;
          }
          continue;
        }
        const allDay = !!ev.start.date;
        const start = allDay ? dayStart(ev.start.date!, tz) : ev.start.dateTime!;
        let end = allDay ? dayStart(ev.end.date!, tz) : ev.end.dateTime!;
        // fim igual ou antes do início (dados inconsistentes): dia inteiro → 1 dia; com hora → 15 min
        if (Date.parse(end) <= Date.parse(start)) end = new Date(Date.parse(start) + (allDay ? 86400000 : 900000)).toISOString();
        const row = {
          title: ev.summary || "(sem título)",
          start_at: start,
          end_at: end,
          all_day: allDay,
          blocks_time: !allDay && ev.transparency !== "transparent",
          location_text: ev.location ?? null,
          gcal_etag: ev.etag,
          deleted_at: null,
        };
        if (!cur) {
          await rest.insert("events", [{ ...row, user_id: userId, source: "gcal", gcal_calendar_id: cal, gcal_event_id: ev.id }]);
          stats.read++;
        } else if (cur.gcal_etag !== ev.etag || cur.deleted_at) {
          await rest.patch("events", `id=eq.${cur.id}`, row);
          stats.read++;
        }
      }
      pageToken = r.data.nextPageToken;
    } while (pageToken);
  }
  // sumiram da janela lida → apagados
  for (const e of existing) {
    const key = `${e.gcal_calendar_id}|${e.gcal_event_id}`;
    if (e.deleted_at || seen.has(key) || !read.includes(e.gcal_calendar_id)) continue;
    if (e.end_at < timeMin || e.start_at > timeMax) continue;
    await rest.patch("events", `id=eq.${e.id}`, { deleted_at: new Date().toISOString() });
    stats.removed++;
  }
  await rest.rpc("mark_gcal_synced", { p_user: userId });
  return stats;
}

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "use POST" });
  const rest = new Rest(env);
  if (await isCron(req, rest)) {
    const users = await rest.rpc<string[]>("google_connected_users", {});
    const results: Record<string, unknown> = {};
    for (const u of users) {
      try {
        results[u] = await syncUser(env, rest, u);
      } catch (e) {
        results[u] = { error: (e as Error).message };
      }
    }
    return json(200, { users: users.length, results });
  }
  const auth = await authorize(req, env);
  if (!auth.ok) return json(auth.status, { error: auth.error });
  if (!auth.userId) return json(401, { error: "Entre com sua conta Google." });
  try {
    return json(200, await syncUser(env, rest, auth.userId));
  } catch (e) {
    return json(502, { error: (e as Error).message });
  }
}

if (import.meta.main) {
  Deno.serve((req) => handle(req, (k) => Deno.env.get(k)));
}

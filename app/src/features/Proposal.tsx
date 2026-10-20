import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localToMin, minToIso, minToLocal, pad } from "@shared/scheduler/index.ts";
import { db, nowIso } from "../data/db";
import { approvePlan, discardPlan, replan } from "../data/planner";
import type { Block, Task } from "../data/types";
import { IconBack, IconTrash } from "../components/Icons";
import { TaskEdit } from "../components/TaskEdit";
import { DateTimeField } from "../components/TimeField";
import { toast } from "../components/Toast";
import { Meta } from "./Inbox";
import { ALERT_LABEL, fmtDayLabel, fmtRange, localDate, tz } from "../lib/format";
import { navigate } from "../lib/router";

export function Proposal({ planId }: { planId: string }) {
  const data = useLiveQuery(async () => {
    const plan = await db.plans.get(planId);
    if (!plan) return null;
    const roots = (await db.tasks.bulkGet(plan.taskIds)).filter((t): t is Task => !!t);
    const children = new Map<string, Task[]>();
    for (const r of roots) children.set(r.id, (await db.tasks.where("parentId").equals(r.id).toArray()).sort((a, b) => a.seq - b.seq));
    const blocks = await db.blocks.where("planId").equals(planId).toArray();
    const byTask = new Map<string, Block[]>();
    for (const b of blocks.sort((a, b) => a.start.localeCompare(b.start))) byTask.set(b.taskId, [...(byTask.get(b.taskId) ?? []), b]);
    const events = (await db.events.bulkGet(plan.eventIds)).filter((e) => !!e);
    const settings = await db.settings.get("me");
    return { plan, roots, children, byTask, events, defaultAlert: settings?.defaultAlertMode ?? "lembrete" };
  }, [planId]);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState<{ id: string; value: string } | null>(null);

  if (data === undefined) return null;
  if (data === null) return <div className="app bare"><div className="empty">Proposta não encontrada.</div></div>;
  const { plan } = data;
  const decided = plan.status !== "proposta";
  const excluded = new Set(plan.excludedTaskIds);
  const reason = new Map(plan.unplaced.map((u) => [u.taskId, u.reason]));

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  const toggle = (t: Task) => run(async () => {
    const isEx = excluded.has(t.id);
    const next = isEx ? plan.excludedTaskIds.filter((x) => x !== t.id) : [...plan.excludedTaskIds, t.id];
    if (isEx && t.status === "inbox") {
      await db.tasks.update(t.id, { status: "pendente", updatedAt: nowIso() });
      await db.tasks.where("parentId").equals(t.id).modify({ status: "pendente" });
    }
    await db.plans.update(planId, { excludedTaskIds: next });
    await replan(planId);
  });

  const removeTask = (t: Task) => run(async () => {
    await db.tasks.where("parentId").equals(t.id).delete();
    await db.tasks.delete(t.id);
    await db.plans.update(planId, { taskIds: plan.taskIds.filter((x) => x !== t.id) });
    await replan(planId);
  });

  const moveBlock = (b: Block, value: string) => run(async () => {
    if (!value) return;
    const [d, hm] = value.split("T");
    const [h, m] = hm.split(":").map(Number);
    const start = localToMin(d, h * 60 + m, tz());
    const dur = Math.round((Date.parse(b.end) - Date.parse(b.start)) / 60000);
    await db.blocks.update(b.id, { start: minToIso(start, tz()), end: minToIso(start + dur, tz()), locked: true, updatedAt: nowIso() });
    await replan(planId);
  });

  const when = (t: Task) => {
    const bs = data.byTask.get(t.id) ?? [];
    if (!bs.length) return null;
    return bs.map((b) => (
      <div key={b.id} className="row wrap" style={{ gap: 6 }}>
        <span className="when">{fmtDayLabel(localDate(b.start))} · {fmtRange(b.start, b.end)}</span>
        {b.windowKind === "fora" && b.region && <span className="chip">em {b.region}</span>}
        {b.locked && <span className="chip accent">fixado</span>}
        {!decided && moving?.id !== b.id && (
          <button className="chip" onClick={() => setMoving({ id: b.id, value: toInput(b.start) })}>mudar horário</button>
        )}
        {!decided && moving?.id === b.id && (
          <div className="row" style={{ width: "100%" }}>
            <div style={{ flex: 1, minWidth: 0 }}><DateTimeField label="Novo início" value={moving.value} onChange={(v) => setMoving({ id: b.id, value: v })} /></div>
            <button className="btn primary" disabled={busy} onClick={() => { const v = moving.value; setMoving(null); moveBlock(b, v); }}>Fixar</button>
          </div>
        )}
      </div>
    ));
  };

  return (
    <div className="app bare">
      <div className="sheet-head">
        <button className="icon-btn" aria-label="Voltar" onClick={() => history.length > 1 ? history.back() : navigate("hoje")}><IconBack /></button>
        <h2>{decided ? (plan.status === "aprovada" ? "Plano aprovado" : "Proposta descartada") : "Proposta"}</h2>
      </div>
      {!decided && <p className="muted small" style={{ marginTop: 0 }}>Confira os horários. Desmarque o que não quer agendar, edite ou mude um horário: o resto se reorganiza.</p>}

      {data.events.length > 0 && (
        <>
          <div className="section-title">Compromissos que entendi</div>
          <div className="stack">
            {data.events.map((e) => (
              <div key={e!.id} className="card row">
                <span style={{ flex: 1 }}><b>{e!.title}</b><br /><span className="small muted">{fmtDayLabel(localDate(e!.start))}{e!.allDay ? " · dia todo" : ` · ${fmtRange(e!.start, e!.end)}`}</span></span>
                {!decided && <button className="icon-btn" aria-label="Remover compromisso" onClick={() => run(async () => { await db.events.delete(e!.id); await replan(planId); })}><IconTrash /></button>}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title">Tarefas</div>
      <div className="stack">
        {data.roots.map((t) => {
          const kids = data.children.get(t.id) ?? [];
          const isEx = excluded.has(t.id);
          return (
            <div key={t.id} className={`card task-card cat-${t.category} ${isEx ? "excluded" : ""}`}>
              <div className="head">
                {!decided && <input type="checkbox" checked={!isEx} disabled={busy} onChange={() => toggle(t)} aria-label={`Agendar ${t.title}`} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row"><span className="dot" /><b style={{ flex: 1 }}>{t.title}</b>
                    {t.inferred && <span className="chip accent">sugestão</span>}
                    {t.routineDate && <span className="chip accent">rotina · {fmtDayLabel(t.routineDate)}</span>}</div>
                  <Meta t={t} />
                  <div className="small muted" style={{ marginTop: 4 }}>Aviso: {ALERT_LABEL[t.alertMode ?? data.defaultAlert]}</div>
                  {!isEx && !kids.length && <div style={{ marginTop: 6 }}>{when(t)}</div>}
                  {!isEx && reason.get(t.id) && <div className="unplaced">{reason.get(t.id)}</div>}
                </div>
              </div>
              {!isEx && kids.length > 0 && (
                <div className="subs">
                  {kids.map((k) => (
                    <div key={k.id}>
                      <div className="sub"><span>{k.seq + 1}.</span><span style={{ flex: 1 }}>{k.title}</span><span className="w">{k.location === "casa" ? "casa" : k.location === "rua" ? `rua${k.region ? ` · ${k.region}` : ""}` : "qualquer"}</span></div>
                      <div style={{ marginLeft: 20 }}>{when(k)}</div>
                      {reason.get(k.id) && <div className="unplaced" style={{ marginLeft: 20 }}>{reason.get(k.id)}</div>}
                      {!decided && editing === k.id && <TaskEdit task={k} isParent={false} onCancel={() => setEditing(null)} onSaved={() => run(async () => { setEditing(null); await replan(planId); })} />}
                      {!decided && editing !== k.id && <button className="btn ghost small" style={{ minHeight: 32, padding: "2px 8px", marginLeft: 12 }} onClick={() => setEditing(k.id)}>editar etapa</button>}
                    </div>
                  ))}
                </div>
              )}
              {!decided && editing === t.id && (
                <TaskEdit task={t} isParent={kids.length > 0} onCancel={() => setEditing(null)} onSaved={() => run(async () => { setEditing(null); await replan(planId); })} />
              )}
              {t.isCooking && (
                <a className="btn ghost" style={{ marginTop: 6, paddingLeft: 0 }} href={`#/cozinha/${t.id}`}>🍳 Receitas e lista de compras</a>
              )}
              {!decided && editing !== t.id && (
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn" onClick={() => setEditing(t.id)}>Editar</button>
                  <span className="spacer" />
                  <button className="icon-btn" aria-label="Apagar tarefa" onClick={() => removeTask(t)}><IconTrash /></button>
                </div>
              )}
            </div>
          );
        })}
        {data.roots.length === 0 && <div className="muted">Nenhuma tarefa nesta proposta.</div>}
      </div>

      {!decided && (
        <div className="sticky-actions">
          <button className="btn" disabled={busy} onClick={() => run(async () => { await discardPlan(planId); toast("Proposta descartada. As tarefas ficaram na Caixa de entrada."); navigate("caixa"); })}>Descartar</button>
          <button className="btn primary" disabled={busy} onClick={() => run(async () => { await approvePlan(planId); toast("Plano aprovado."); navigate("hoje"); })}>Aprovar</button>
        </div>
      )}
    </div>
  );
}

function toInput(iso: string) {
  const l = minToLocal(Math.floor(Date.parse(iso) / 60000), tz());
  return `${l.date}T${pad(Math.floor(l.minutes / 60))}:${pad(l.minutes % 60)}`;
}

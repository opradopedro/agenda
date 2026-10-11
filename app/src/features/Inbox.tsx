import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { processCapture } from "../data/capture";
import { db, nowIso } from "../data/db";
import { planTasks } from "../data/planner";
import type { Task } from "../data/types";
import { TaskEdit } from "../components/TaskEdit";
import { toast } from "../components/Toast";
import { IconTrash } from "../components/Icons";
import { CATEGORY_LABEL, fmtDur, fmtWhen, LOCATION_LABEL } from "../lib/format";
import { navigate } from "../lib/router";

export function Inbox() {
  const data = useLiveQuery(async () => {
    const captures = await db.captures.where("status").anyOf(["pendente", "erro", "interpretando"]).toArray();
    const tasks = await db.tasks.toArray();
    const kids = new Set(tasks.filter((t) => t.parentId).map((t) => t.parentId!));
    const roots = tasks.filter((t) => !t.parentId);
    const suggestions = roots.filter((t) => t.status === "inbox");
    // sem horário: tarefas (ou etapas) aceitas que não têm bloco
    const withBlock = new Set((await db.blocks.where("status").anyOf(["proposto", "confirmado", "em_andamento"]).toArray()).map((b) => b.taskId));
    const unscheduled = tasks.filter((t) => t.status === "pendente" && !kids.has(t.id) && !withBlock.has(t.id));
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return { captures, suggestions, unscheduled, byId, kids };
  }, []);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  async function scheduleAll(ids: string[]) {
    setBusy(true);
    const out = await planTasks(ids, "manual");
    setBusy(false);
    if (out.mode === "proposta") navigate(`proposta/${out.planId}`);
    else toast(`${out.placed} agendada(s)${out.unplaced ? `, ${out.unplaced} ainda sem horário` : ""}.`);
  }

  async function accept(t: Task) {
    await db.tasks.update(t.id, { status: "pendente", updatedAt: nowIso() });
    await db.tasks.where("parentId").equals(t.id).modify({ status: "pendente" });
    await scheduleAll([t.id]);
  }

  async function remove(t: Task) {
    await db.tasks.where("parentId").equals(t.id).delete();
    await db.tasks.delete(t.id);
  }

  if (!data) return null;
  const empty = !data.captures.length && !data.suggestions.length && !data.unscheduled.length;
  return (
    <>
      <header className="top"><h1>Caixa de entrada</h1></header>
      {empty && <div className="empty"><div className="big">📥</div>Tudo organizado. Escreva ou fale embaixo o que precisa fazer.</div>}

      {data.captures.length > 0 && (
        <>
          <div className="section-title">Capturas não processadas</div>
          <div className="stack">
            {data.captures.map((c) => (
              <div key={c.id} className="card">
                <div>{c.rawText}</div>
                {c.error && <div className="small" style={{ color: "var(--danger)", marginTop: 4 }}>{c.error}</div>}
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn" disabled={c.status === "interpretando"} onClick={async () => {
                    try {
                      const r = await processCapture(c.id);
                      if (r.outcome?.mode === "proposta") navigate(`proposta/${r.outcome.planId}`);
                    } catch (e) { toast((e as Error).message); }
                  }}>{c.status === "interpretando" ? "Processando…" : "Tentar de novo"}</button>
                  <button className="btn ghost danger" onClick={() => db.captures.update(c.id, { status: "arquivado" })}>Descartar</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {data.unscheduled.length > 0 && (
        <>
          <div className="section-title row"><span className="spacer">Sem horário</span>
            <button className="btn ghost" disabled={busy} onClick={() => scheduleAll([...new Set(data.unscheduled.map((t) => t.parentId ?? t.id))])}>Agendar todas</button></div>
          <div className="stack">
            {data.unscheduled.map((t) => (
              <div key={t.id} className={`card task-card cat-${t.category}`}>
                <div className="row"><span className="dot" /><b style={{ flex: 1 }}>{t.title}</b>
                  <button className="icon-btn" aria-label="Apagar" onClick={() => remove(t)}><IconTrash /></button></div>
                {t.parentId && <div className="small muted">Etapa de: {data.byId.get(t.parentId)?.title}</div>}
                <Meta t={t} />
                {t.unplacedReason && <div className="unplaced">{t.unplacedReason}</div>}
                {editing === t.id ? (
                  <TaskEdit task={t} isParent={false} onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); await scheduleAll([t.parentId ?? t.id]); }} />
                ) : (
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn" onClick={() => setEditing(t.id)}>Editar</button>
                    <button className="btn primary" disabled={busy} onClick={() => scheduleAll([t.parentId ?? t.id])}>Agendar</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {data.suggestions.length > 0 && (
        <>
          <div className="section-title">Sugestões da IA</div>
          <div className="stack">
            {data.suggestions.map((t) => (
              <div key={t.id} className={`card task-card cat-${t.category}`}>
                <div className="row"><span className="dot" /><b style={{ flex: 1 }}>{t.title}</b></div>
                <Meta t={t} />
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn ghost danger" onClick={() => remove(t)}>Descartar</button>
                  <button className="btn primary spacer" disabled={busy} onClick={() => accept(t)}>Quero fazer</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export function Meta({ t }: { t: Task }) {
  return (
    <div className="row wrap" style={{ marginTop: 6 }}>
      <span className="chip">{fmtDur(t.durationMin)}</span>
      <span className="chip">{LOCATION_LABEL[t.location]}{t.region ? ` · ${t.region}` : ""}</span>
      <span className="chip">{CATEGORY_LABEL[t.category]}</span>
      {t.deadline && <span className={`chip ${t.deadlineHard ? "warn" : ""}`}>até {fmtWhen(t.deadline)}</span>}
      {t.priority >= 3 && <span className="chip warn">{t.priority === 4 ? "Urgente" : "Alta"}</span>}
    </div>
  );
}

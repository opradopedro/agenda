import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, nowIso } from "../data/db";
import { checkin, type CheckinResponse } from "../data/planner";
import type { AlertMode } from "../data/types";
import { IconBack } from "../components/Icons";
import { toast } from "../components/Toast";
import { ALERT_LABEL, fmtDayLabel, fmtDur, fmtRange, localDate } from "../lib/format";
import { navigate } from "../lib/router";

export function Checkin({ blockId }: { blockId: string }) {
  const data = useLiveQuery(async () => {
    const block = await db.blocks.get(blockId);
    if (!block) return null;
    const task = await db.tasks.get(block.taskId);
    const parent = task?.parentId ? await db.tasks.get(task.parentId) : undefined;
    const settings = await db.settings.get("me");
    return { block, task, parent, settings };
  }, [blockId]);
  const [extra, setExtra] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  if (data === undefined) return null;
  if (data === null) return <div className="app bare"><div className="empty">Esse horário não existe mais.</div></div>;
  const { block, task, parent, settings } = data;
  const moreDefault = settings?.moreTimeDefaultMin ?? 15;
  const finished = block.status === "concluido" || block.status === "remarcado";

  async function answer(r: CheckinResponse, min?: number) {
    setBusy(true);
    try {
      const out = await checkin(blockId, r, min);
      toast(out.message);
      navigate(out.planId ? `proposta/${out.planId}` : "hoje");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app bare">
      <div className="sheet-head">
        <button className="icon-btn" aria-label="Voltar" onClick={() => history.length > 1 ? history.back() : navigate("hoje")}><IconBack /></button>
        <h2>Check-in</h2>
      </div>
      <div className={`card cat-${task?.category ?? "pessoal"}`} style={{ borderLeft: "4px solid var(--cat)" }}>
        <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{task?.title ?? "Tarefa"}</div>
        {parent && <div className="muted small">{parent.title}</div>}
        {(task?.isCooking || parent?.isCooking) && (
          <a className="btn ghost" style={{ paddingLeft: 0 }} href={`#/cozinha/${task!.id}`}>🍳 Receitas e lista de compras</a>
        )}
        <div className="muted" style={{ marginTop: 4 }}>{fmtDayLabel(localDate(block.start))} · {fmtRange(block.start, block.end)}{block.windowKind === "fora" && block.region ? ` · em ${block.region}` : ""}</div>
        {task && (
          <label className="field" style={{ marginTop: 12 }}><span>Aviso desta tarefa</span>
            <div className="seg">
              {(["lembrete", "alarme", "nenhum"] as AlertMode[]).map((a) => (
                <button key={a} type="button" className={(task.alertMode ?? settings?.defaultAlertMode) === a ? "on" : ""}
                  onClick={() => db.tasks.update(task.id, { alertMode: a, updatedAt: nowIso() })}>{ALERT_LABEL[a]}</button>
              ))}
            </div></label>
        )}
      </div>

      {finished ? (
        <p className="muted" style={{ marginTop: 18 }}>{block.status === "concluido" ? "Você já marcou como concluída." : "Essa tarefa foi remarcada."}</p>
      ) : (
        <div className="checkin-actions">
          <p className="muted" style={{ margin: 0 }}>Terminou?</p>
          <button className="btn primary big" disabled={busy} onClick={() => answer("terminei")}>✓ Terminei</button>
          {extra === null ? (
            <button className="btn big" disabled={busy} onClick={() => setExtra(moreDefault)}>⏱ Preciso de mais tempo</button>
          ) : (
            <div className="card stack">
              <b>Quanto tempo a mais?</b>
              <div className="seg">
                {[15, 30, 45, 60].map((m) => <button key={m} className={extra === m ? "on" : ""} onClick={() => setExtra(m)}>{fmtDur(m)}</button>)}
              </div>
              <button className="btn primary" disabled={busy} onClick={() => answer("mais_tempo", extra)}>Estender {fmtDur(extra)}</button>
            </div>
          )}
          <button className="btn big" disabled={busy} onClick={() => answer("remarcar")}>↻ Remarcar</button>
        </div>
      )}
    </div>
  );
}

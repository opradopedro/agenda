import { useState } from "react";
import { localToMin, minToIso, minToLocal, pad } from "@shared/scheduler/index.ts";
import { CATEGORIES } from "@shared/interpret/contract.ts";
import { db, nowIso } from "../data/db";
import type { AlertMode, Task } from "../data/types";
import { ALERT_LABEL, CATEGORY_LABEL, tz } from "../lib/format";
import { DateTimeField } from "./TimeField";

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const l = minToLocal(Math.floor(Date.parse(iso) / 60000), tz());
  return `${l.date}T${pad(Math.floor(l.minutes / 60))}:${pad(l.minutes % 60)}`;
};
const fromLocalInput = (v: string) => {
  if (!v) return null;
  const [d, t] = v.split("T");
  const [h, m] = t.split(":").map(Number);
  return minToIso(localToMin(d, h * 60 + m, tz()), tz());
};

/** Editor compacto de tarefa. `isParent`: tarefa com etapas (duração = soma). */
export function TaskEdit({ task, isParent, onSaved, onCancel }: { task: Task; isParent: boolean; onSaved: () => void; onCancel: () => void }) {
  const [t, setT] = useState<Task>(task);
  const set = <K extends keyof Task>(k: K, v: Task[K]) => setT((cur) => ({ ...cur, [k]: v }));

  async function save() {
    await db.tasks.update(task.id, { ...t, region: t.location === "rua" ? t.region?.trim() || null : null, updatedAt: nowIso() });
    onSaved();
  }

  return (
    <div className="stack" style={{ marginTop: 10 }}>
      <label className="field"><span>Título</span><input type="text" value={t.title} onChange={(e) => set("title", e.target.value)} /></label>
      <div className="grid2">
        {!isParent && (
          <label className="field"><span>Duração (min)</span>
            <input type="number" inputMode="numeric" min={5} step={5} value={t.durationMin} onChange={(e) => set("durationMin", Math.max(5, Number(e.target.value) || 5))} /></label>
        )}
        <label className="field"><span>Categoria</span>
          <select value={t.category} onChange={(e) => set("category", e.target.value as Task["category"])}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select></label>
      </div>
      {!isParent && (
        <>
          <label className="field"><span>Onde</span>
            <div className="seg">
              {(["casa", "rua", "qualquer"] as const).map((l) => (
                <button key={l} type="button" className={t.location === l ? "on" : ""} onClick={() => set("location", l)}>{l === "casa" ? "Casa" : l === "rua" ? "Rua" : "Qualquer"}</button>
              ))}
            </div></label>
          {t.location === "rua" && (
            <label className="field"><span>Cidade (opcional)</span>
              <input type="text" placeholder="Qualquer uma" value={t.region ?? ""} onChange={(e) => set("region", e.target.value)} /></label>
          )}
        </>
      )}
      <div className="grid2">
        <label className="field"><span>Prioridade</span>
          <select value={t.priority} onChange={(e) => set("priority", Number(e.target.value))}>
            <option value={1}>Baixa</option><option value={2}>Normal</option><option value={3}>Alta</option><option value={4}>Urgente</option>
          </select></label>
      </div>
      <label className="field"><span>Prazo</span>
        <DateTimeField label="Prazo" clearable value={toLocalInput(t.deadline)} onChange={(v) => set("deadline", fromLocalInput(v))} /></label>
      {t.deadline && (
        <div className="switch-row"><div className="label">Prazo rígido<small>Desligado: pode passar do prazo se não couber.</small></div>
          <input type="checkbox" className="toggle" checked={t.deadlineHard} onChange={(e) => set("deadlineHard", e.target.checked)} /></div>
      )}
      <label className="field"><span>Aviso</span>
        <div className="seg">
          {(["lembrete", "alarme", "nenhum"] as AlertMode[]).map((a) => (
            <button key={a} type="button" className={(t.alertMode ?? "padrao") === a ? "on" : ""} onClick={() => set("alertMode", a)}>{ALERT_LABEL[a]}</button>
          ))}
        </div></label>
      {!isParent && (
        <div className="switch-row"><div className="label">Pode dividir em partes<small>Ex.: estudar 4h em blocos menores.</small></div>
          <input type="checkbox" className="toggle" checked={t.splittable} onChange={(e) => { set("splittable", e.target.checked); set("minChunkMin", e.target.checked ? 30 : null); }} /></div>
      )}
      <div className="row">
        <button className="btn" onClick={onCancel}>Cancelar</button>
        <button className="btn primary spacer" onClick={save}>Salvar e reorganizar</button>
      </div>
    </div>
  );
}

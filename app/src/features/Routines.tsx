import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { describeRrule, parseRrule, toRrule } from "@shared/scheduler/index.ts";
import { CATEGORIES } from "@shared/interpret/contract.ts";
import { db, newId } from "../data/db";
import { WEEKDAYS_SHORT } from "../data/routine";
import { deleteRoutine, emptyTemplate, saveRoutine } from "../data/routines";
import type { AlertMode, LocationReq, Routine, RoutineStep } from "../data/types";
import { IconBack, IconTrash } from "../components/Icons";
import { TimeField } from "../components/TimeField";
import { toast } from "../components/Toast";
import { ALERT_LABEL, CATEGORY_LABEL, fmtDur, todayLocal } from "../lib/format";
import { navigate } from "../lib/router";

export function Routines({ editId }: { editId?: string }) {
  const routines = useLiveQuery(() => db.routines.toArray(), []);
  if (editId) return <RoutineEditor id={editId} />;
  return (
    <div className="app bare">
      <div className="sheet-head">
        <button className="icon-btn" aria-label="Voltar" onClick={() => navigate("config")}><IconBack /></button>
        <h2>Rotinas</h2>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Tarefas que se repetem. A cada semana elas entram sozinhas e o agendador encaixa. Dá também para criar falando, ex.: "toda quarta faço marmita".
      </p>
      <div className="stack">
        {routines?.map((r) => (
          <a key={r.id} className="card" href={`#/rotinas/${r.id}`} style={{ textDecoration: "none", color: "inherit", opacity: r.active ? 1 : 0.55 }}>
            <div className="row"><b style={{ flex: 1 }}>{r.title}</b>{!r.active && <span className="chip">pausada</span>}</div>
            <div className="small muted">
              {describeRrule(r.rrule)}
              {r.preferredStart ? ` · entre ${r.preferredStart} e ${r.preferredEnd ?? "o fim do dia"}` : ""} · {fmtDur(r.template.subtasks.length ? r.template.subtasks.reduce((a, s) => a + s.durationMin, 0) : r.template.durationMin)}
            </div>
          </a>
        ))}
        {routines?.length === 0 && <div className="empty">Nenhuma rotina ainda.</div>}
        <a className="btn primary" href="#/rotinas/nova">Nova rotina</a>
      </div>
    </div>
  );
}

function blank(): Routine {
  const ts = new Date().toISOString();
  return {
    id: newId(),
    title: "",
    rrule: "FREQ=WEEKLY;BYDAY=WE",
    template: emptyTemplate(),
    preferredStart: null,
    preferredEnd: null,
    startDate: todayLocal(),
    active: true,
    generatedUntil: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

function RoutineEditor({ id }: { id: string }) {
  const loaded = useLiveQuery(async () => (id === "nova" ? blank() : (await db.routines.get(id)) ?? null), [id]);
  if (loaded === undefined) return null;
  if (loaded === null) return <div className="app bare"><div className="empty">Rotina não encontrada.</div></div>;
  return <EditorForm initial={loaded} isNew={id === "nova"} />;
}

function EditorForm({ initial, isNew }: { initial: Routine; isNew: boolean }) {
  const [r, setR] = useState<Routine>(initial);
  const [busy, setBusy] = useState(false);
  const rule = parseRrule(r.rrule);
  const t = r.template;
  const setT = (patch: Partial<Routine["template"]>) => setR((cur) => ({ ...cur, template: { ...cur.template, ...patch } }));
  const setRule = (weekdays: number[], interval = rule.interval) => setR((cur) => ({ ...cur, rrule: toRrule({ weekdays, interval }) }));
  const setStep = (i: number, patch: Partial<RoutineStep>) => setT({ subtasks: t.subtasks.map((s, k) => (k === i ? { ...s, ...patch } : s)) });

  async function save() {
    if (!r.title.trim()) return toast("Dê um nome para a rotina.");
    if (!rule.weekdays.length) return toast("Escolha pelo menos um dia.");
    setBusy(true);
    const out = await saveRoutine({ ...r, title: r.title.trim(), template: { ...t, title: t.title || r.title.trim() } });
    setBusy(false);
    toast("Rotina salva.");
    if (out?.mode === "proposta") navigate(`proposta/${out.planId}`);
    else navigate("rotinas");
  }

  return (
    <div className="app bare">
      <div className="sheet-head">
        <button className="icon-btn" aria-label="Voltar" onClick={() => navigate("rotinas")}><IconBack /></button>
        <h2>{isNew ? "Nova rotina" : "Editar rotina"}</h2>
        {!isNew && (
          <button className="icon-btn" aria-label="Apagar rotina" onClick={async () => {
            if (!confirm("Apagar a rotina e as próximas ocorrências?")) return;
            await deleteRoutine(r.id);
            navigate("rotinas");
          }}><IconTrash /></button>
        )}
      </div>
      <div className="stack">
        <label className="field"><span>Nome</span>
          <input type="text" placeholder="ex.: Marmitas da semana" value={r.title} onChange={(e) => setR({ ...r, title: e.target.value })} /></label>

        <label className="field"><span>Dias</span>
          <div className="row wrap">
            {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
              const on = rule.weekdays.includes(wd);
              return (
                <button key={wd} type="button" className={`chip ${on ? "on" : ""}`} style={{ padding: "8px 14px", fontSize: "0.9rem" }}
                  onClick={() => setRule(on ? rule.weekdays.filter((x) => x !== wd) : [...rule.weekdays, wd])}>{WEEKDAYS_SHORT[wd]}</button>
              );
            })}
          </div></label>
        <div className="seg">
          <button type="button" className={rule.interval === 1 ? "on" : ""} onClick={() => setRule(rule.weekdays, 1)}>Toda semana</button>
          <button type="button" className={rule.interval === 2 ? "on" : ""} onClick={() => setRule(rule.weekdays, 2)}>A cada 2 semanas</button>
        </div>

        <label className="switch-row">
          <span className="label">Horário preferido<small>{r.preferredStart ? "Só encaixa dentro dessa janela" : "Qualquer horário livre do dia"}</small></span>
          <input type="checkbox" className="toggle" checked={!!r.preferredStart}
            onChange={(e) => setR({ ...r, preferredStart: e.target.checked ? "16:00" : null, preferredEnd: e.target.checked ? "19:00" : null })} />
        </label>
        {r.preferredStart && (
          <div className="row wrap">
            <span className="small muted">entre</span>
            <TimeField label="Início da janela" value={r.preferredStart} onChange={(v) => setR({ ...r, preferredStart: v ?? r.preferredStart })} />
            <span className="small muted">e</span>
            <TimeField label="Fim da janela" value={r.preferredEnd ?? "23:00"} onChange={(v) => setR({ ...r, preferredEnd: v })} />
          </div>
        )}

        <div className="section-title" style={{ margin: "8px 0 0" }}>A tarefa</div>
        <div className="grid2">
          {!t.subtasks.length && (
            <label className="field"><span>Duração (min)</span>
              <input type="number" inputMode="numeric" min={5} step={5} value={t.durationMin} onChange={(e) => setT({ durationMin: Math.max(5, Number(e.target.value) || 5) })} /></label>
          )}
          <label className="field"><span>Categoria</span>
            <select value={t.category} onChange={(e) => setT({ category: e.target.value as typeof t.category })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select></label>
        </div>
        {!t.subtasks.length && (
          <LocationField value={t.location} region={t.region} onChange={(location, region) => setT({ location, region })} />
        )}
        <label className="field"><span>Aviso</span>
          <div className="seg">
            {(["lembrete", "alarme", "nenhum"] as AlertMode[]).map((a) => (
              <button key={a} type="button" className={t.alertMode === a ? "on" : ""} onClick={() => setT({ alertMode: a })}>{ALERT_LABEL[a]}</button>
            ))}
          </div></label>
        <label className="switch-row"><span className="label">Preparo de comida<small>Libera o modo cozinha (receitas e lista de compras)</small></span>
          <input type="checkbox" className="toggle" checked={t.isCooking} onChange={(e) => setT({ isCooking: e.target.checked })} /></label>

        <div className="section-title row" style={{ margin: "8px 0 0" }}><span className="spacer">Etapas (opcional)</span>
          <button className="btn ghost" onClick={() => setT({ subtasks: [...t.subtasks, { title: "", durationMin: 30, location: "casa", region: null }] })}>+ etapa</button></div>
        {t.subtasks.map((s, i) => (
          <div key={i} className="card stack">
            <div className="row">
              <input type="text" placeholder={`Etapa ${i + 1}`} value={s.title} onChange={(e) => setStep(i, { title: e.target.value })} />
              <button className="icon-btn" aria-label="Remover etapa" onClick={() => setT({ subtasks: t.subtasks.filter((_, k) => k !== i) })}><IconTrash /></button>
            </div>
            <label className="field"><span>Duração (min)</span>
              <input type="number" inputMode="numeric" min={5} step={5} value={s.durationMin} onChange={(e) => setStep(i, { durationMin: Math.max(5, Number(e.target.value) || 5) })} /></label>
            <LocationField value={s.location} region={s.region} onChange={(location, region) => setStep(i, { location, region })} />
          </div>
        ))}

        <label className="switch-row"><span className="label">Ativa<small>Pausada: não gera novas ocorrências</small></span>
          <input type="checkbox" className="toggle" checked={r.active} onChange={(e) => setR({ ...r, active: e.target.checked })} /></label>
      </div>
      <div className="sticky-actions">
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? "Salvando…" : "Salvar"}</button>
      </div>
    </div>
  );
}

function LocationField({ value, region, onChange }: { value: LocationReq; region: string | null; onChange: (l: LocationReq, r: string | null) => void }) {
  return (
    <>
      <label className="field"><span>Onde</span>
        <div className="seg">
          {(["casa", "rua", "qualquer"] as const).map((l) => (
            <button key={l} type="button" className={value === l ? "on" : ""} onClick={() => onChange(l, l === "rua" ? region : null)}>{l === "casa" ? "Casa" : l === "rua" ? "Rua" : "Qualquer"}</button>
          ))}
        </div></label>
      {value === "rua" && (
        <label className="field"><span>Cidade (opcional)</span>
          <input type="text" placeholder="Qualquer uma" value={region ?? ""} onChange={(e) => onChange(value, e.target.value || null)} /></label>
      )}
    </>
  );
}

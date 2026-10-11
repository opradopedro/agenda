import { useState } from "react";
import { applyRoutine, WEEKDAYS, WEEKDAYS_SHORT } from "../data/routine";
import type { AlertMode, RoutineDraft, ScheduleMode, Settings, TimeRange } from "../data/types";
import { TimeField } from "../components/TimeField";

type Where = "trabalho" | "terminal" | "casa" | null;

const STEPS = ["Horários", "Lugares", "Estágio", "Faculdade", "Deslocamentos", "Preferências"];
const WEEK = [1, 2, 3, 4, 5, 6, 0];

const TRAVEL_LABELS: [string, string][] = [
  ["casa>trabalho", "Casa → Escritório"],
  ["trabalho>casa", "Escritório → Casa"],
  ["casa>terminal", "Casa → Terminal"],
  ["terminal>casa", "Terminal → Casa"],
  ["trabalho>faculdade", "Escritório → Faculdade"],
  ["terminal>faculdade", "Terminal → Faculdade"],
  ["casa>faculdade", "Casa → Faculdade"],
  ["faculdade>casa", "Faculdade → Casa"],
];

export function Onboarding({ settings, onDone, editing = false }: { settings: Settings; onDone: () => void; editing?: boolean }) {
  const [step, setStep] = useState(0);
  const [r, setR] = useState<RoutineDraft>(() => structuredClone(settings.routine));
  const [flexWake, setFlexWake] = useState(settings.wakeTime);
  const [flexSleep, setFlexSleep] = useState(settings.sleepTime);
  const [mode, setMode] = useState<ScheduleMode>(settings.scheduleMode);
  const [alert, setAlert] = useState<AlertMode>(settings.defaultAlertMode);
  const [returnHome, setReturnHome] = useState(settings.returnHomeInGaps);
  const [saving, setSaving] = useState(false);

  const upd = (fn: (d: RoutineDraft) => void) =>
    setR((cur) => {
      const next = structuredClone(cur);
      fn(next);
      return next;
    });

  const terminalDay = Object.keys(r.internship.days).map(Number).find((d) => r.internship.days[d] === "terminal") ?? -1;
  const setTerminalDay = (wd: number) =>
    upd((d) => {
      for (const k of Object.keys(d.internship.days).map(Number)) if (d.internship.days[k] === "terminal") d.internship.days[k] = "trabalho";
      if (wd >= 0) d.internship.days[wd] = "terminal";
    });

  // ao desligar "mesmo horário", cada dia começa com o horário comum
  const setSleepSame = (same: boolean) =>
    upd((d) => {
      if (!same) for (const wd of WEEK) d.sleep.days[wd] = { wake: d.sleep.wake, sleep: d.sleep.sleep };
      d.sleep.sameTime = same;
    });
  const setRangeSame = (key: "internship" | "college", same: boolean) =>
    upd((d) => {
      if (!same) for (const wd of WEEK) d[key].times[wd] = { start: d[key].start, end: d[key].end };
      d[key].sameTime = same;
    });

  const anyNoTime = r.sleep.sameTime
    ? r.sleep.wake === null || r.sleep.sleep === null
    : WEEK.some((wd) => r.sleep.days[wd]?.wake === null || r.sleep.days[wd]?.sleep === null);

  async function finish() {
    setSaving(true);
    await applyRoutine(r, { wakeTime: flexWake, sleepTime: flexSleep, scheduleMode: mode, defaultAlertMode: alert, returnHomeInGaps: returnHome });
    onDone();
  }

  const last = step === STEPS.length - 1;
  return (
    <div className="app bare onb">
      <div className="progress">{STEPS.map((s, i) => <div key={s} className={i <= step ? "on" : ""} />)}</div>

      {step === 0 && (
        <div className="stack">
          <h1>{editing ? "Sua rotina" : "Vamos montar sua semana"}</h1>
          <p className="lead">Tudo aqui pode ser mudado depois em Config. Comece pelos horários em que você está acordado.</p>
          <SameToggle checked={r.sleep.sameTime} onChange={setSleepSame} />
          {r.sleep.sameTime ? (
            <div className="grid2">
              <label className="field"><span>Acordo às</span>
                <TimeField label="Acordo às" value={r.sleep.wake} noneLabel="sem horário" fallback="07:00" onChange={(v) => upd((d) => void (d.sleep.wake = v))} /></label>
              <label className="field"><span>Durmo às</span>
                <TimeField label="Durmo às" value={r.sleep.sleep} noneLabel="sem horário" fallback="00:00" onChange={(v) => upd((d) => void (d.sleep.sleep = v))} /></label>
            </div>
          ) : (
            <div className="times-grid">
              <span /><span className="head">Acordo</span><span className="head">Durmo</span>
              {WEEK.map((wd) => (
                <Row3 key={wd} day={WEEKDAYS_SHORT[wd]}>
                  <TimeField label={`${WEEKDAYS[wd]}: acordo`} value={r.sleep.days[wd]?.wake ?? null} noneLabel="sem horário" fallback="07:00"
                    onChange={(v) => upd((d) => void (d.sleep.days[wd] = { ...d.sleep.days[wd], wake: v }))} />
                  <TimeField label={`${WEEKDAYS[wd]}: durmo`} value={r.sleep.days[wd]?.sleep ?? null} noneLabel="sem horário" fallback="00:00"
                    onChange={(v) => upd((d) => void (d.sleep.days[wd] = { ...d.sleep.days[wd], sleep: v }))} />
                </Row3>
              ))}
            </div>
          )}
          {anyNoTime && (
            <div className="card stack">
              <span className="small">Nos dias sem horário fixo, planejar como se eu estivesse acordado</span>
              <div className="row wrap">
                <span className="small muted">das</span>
                <TimeField label="Referência: acordar" value={flexWake} onChange={(v) => setFlexWake(v ?? "08:00")} />
                <span className="small muted">às</span>
                <TimeField label="Referência: dormir" value={flexSleep} onChange={(v) => setFlexSleep(v ?? "00:00")} />
              </div>
            </div>
          )}
          <p className="muted small">Nada é agendado enquanto você dorme, e as notificações ficam em silêncio nesse período.</p>
        </div>
      )}

      {step === 1 && (
        <div className="stack">
          <h1>Lugares</h1>
          <p className="lead">A cidade de cada lugar diz ao agendador o que dá para fazer onde: tarefas de casa só em casa; recados na cidade em que você estiver.</p>
          {(Object.keys(r.places) as (keyof RoutineDraft["places"])[]).map((k) => (
            <div key={k} className="grid2">
              <label className="field"><span>{k === "casa" ? "Casa" : k === "trabalho" ? "Trabalho" : k === "terminal" ? "Terminal" : "Faculdade"}</span>
                <input type="text" value={r.places[k].name} onChange={(e) => upd((d) => void (d.places[k].name = e.target.value))} /></label>
              <label className="field"><span>Cidade</span>
                <input type="text" value={r.places[k].region} onChange={(e) => upd((d) => void (d.places[k].region = e.target.value))} /></label>
            </div>
          ))}
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <h1>Estágio</h1>
          <div className="switch-row"><div className="label">Tenho estágio</div>
            <input type="checkbox" className="toggle" checked={r.internship.enabled} onChange={(e) => upd((d) => void (d.internship.enabled = e.target.checked))} /></div>
          {r.internship.enabled && (
            <>
              <label className="field"><span>Qual é o dia do terminal?</span>
                <select value={terminalDay} onChange={(e) => setTerminalDay(Number(e.target.value))}>
                  <option value={-1}>Não vou ao terminal</option>
                  {[1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{WEEKDAYS[d]}</option>)}
                </select>
              </label>
              <SameToggle checked={r.internship.sameTime} onChange={(v) => setRangeSame("internship", v)} />
              {r.internship.sameTime && (
                <RangeFields value={r.internship} onChange={(t) => upd((d) => Object.assign(d.internship, t))} />
              )}
              <p className="muted small" style={{ margin: 0 }}>Onde é o estágio em cada dia (home office = Casa):</p>
              <div>
                {WEEK.map((wd) => {
                  const where = r.internship.days[wd] ?? null;
                  return (
                    <div key={wd} className="day-card">
                      <b>{WEEKDAYS[wd]}</b>
                      <PlaceSeg value={where} onChange={(v) => upd((d) => void (d.internship.days[wd] = v))} />
                      {where && !r.internship.sameTime && (
                        <RangeFields value={r.internship.times[wd] ?? r.internship} onChange={(t) => upd((d) => void (d.internship.times[wd] = t))} />
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="stack">
          <h1>Faculdade</h1>
          <div className="switch-row"><div className="label">Tenho aula</div>
            <input type="checkbox" className="toggle" checked={r.college.enabled} onChange={(e) => upd((d) => void (d.college.enabled = e.target.checked))} /></div>
          {r.college.enabled && (
            <>
              <p className="muted small" style={{ margin: 0 }}>Quais dias?</p>
              <div className="row wrap">
                {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
                  const on = r.college.days.includes(wd);
                  return (
                    <button key={wd} type="button" className={`chip ${on ? "on" : ""}`} style={{ padding: "8px 14px", fontSize: "0.9rem" }}
                      onClick={() => upd((d) => void (d.college.days = on ? d.college.days.filter((x) => x !== wd) : [...d.college.days, wd].sort()))}>
                      {WEEKDAYS_SHORT[wd]}
                    </button>
                  );
                })}
              </div>
              <SameToggle checked={r.college.sameTime} onChange={(v) => setRangeSame("college", v)} />
              {r.college.sameTime ? (
                <RangeFields value={r.college} onChange={(t) => upd((d) => Object.assign(d.college, t))} />
              ) : (
                <div>
                  {WEEK.filter((wd) => r.college.days.includes(wd)).map((wd) => (
                    <div key={wd} className="day-card">
                      <b>{WEEKDAYS[wd]}</b>
                      <RangeFields value={r.college.times[wd] ?? r.college} onChange={(t) => upd((d) => void (d.college.times[wd] = t))} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="stack">
          <h1>Deslocamentos</h1>
          <p className="lead">Tempo de carro, em minutos. O agendador desconta esse tempo antes de cada compromisso.</p>
          <div className="travel-grid">
            {TRAVEL_LABELS.map(([k, label]) => (
              <Travel key={k} label={label} value={r.travel[k] ?? 0} onChange={(v) => upd((d) => void (d.travel[k] = v))} />
            ))}
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="stack">
          <h1>Como agendar</h1>
          <label className="field"><span>Quando eu capturar tarefas</span>
            <div className="seg">
              <button type="button" className={mode === "proposta" ? "on" : ""} onClick={() => setMode("proposta")}>Mostrar proposta</button>
              <button type="button" className={mode === "direto" ? "on" : ""} onClick={() => setMode("direto")}>Agendar direto</button>
            </div>
          </label>
          <p className="muted small">{mode === "proposta" ? "Você vê os horários sugeridos e aprova ou edita antes de entrarem na agenda." : "As tarefas entram direto na agenda; dá para mexer depois."}</p>
          <label className="field"><span>Aviso padrão das tarefas</span>
            <div className="seg">
              {(["lembrete", "alarme", "nenhum"] as AlertMode[]).map((a) => (
                <button key={a} type="button" className={alert === a ? "on" : ""} onClick={() => setAlert(a)}>{a === "lembrete" ? "Lembrete" : a === "alarme" ? "Alarme" : "Sem aviso"}</button>
              ))}
            </div>
          </label>
          <p className="muted small">Lembrete é uma notificação comum. Alarme toca até você dispensar. Dá para mudar por tarefa.</p>
          <div className="switch-row"><div className="label">Voltar para casa entre compromissos<small>Desligado: entre o estágio e a faculdade você fica em {r.places.trabalho.region || "Santos"}.</small></div>
            <input type="checkbox" className="toggle" checked={returnHome} onChange={(e) => setReturnHome(e.target.checked)} /></div>
        </div>
      )}

      <div className="sticky-actions" style={{ marginTop: 24 }}>
        {step > 0 ? <button className="btn" onClick={() => setStep(step - 1)}>Voltar</button> : editing ? <button className="btn" onClick={onDone}>Cancelar</button> : null}
        <button className="btn primary" disabled={saving} onClick={() => (last ? finish() : setStep(step + 1))}>
          {last ? (saving ? "Salvando…" : "Concluir") : "Continuar"}
        </button>
      </div>
    </div>
  );
}

function SameToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch-row">
      <span className="label">Mesmo horário todos os dias<small>{checked ? "Desligue para escolher um horário por dia." : "Cada dia tem o seu horário."}</small></span>
      <input type="checkbox" className="toggle" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function RangeFields({ value, onChange }: { value: TimeRange; onChange: (t: TimeRange) => void }) {
  const bad = value.end <= value.start;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row wrap">
        <span className="small muted">das</span>
        <TimeField label="Começa" value={value.start} onChange={(v) => onChange({ start: v ?? value.start, end: value.end })} />
        <span className="small muted">às</span>
        <TimeField label="Termina" value={value.end} onChange={(v) => onChange({ start: value.start, end: v ?? value.end })} />
      </div>
      {bad && <span className="small" style={{ color: "var(--danger)" }}>O fim precisa ser depois do início.</span>}
    </div>
  );
}

function Row3({ day, children }: { day: string; children: React.ReactNode }) {
  return (
    <>
      <span style={{ textTransform: "capitalize", fontWeight: 600 }}>{day}</span>
      {children}
    </>
  );
}

function PlaceSeg({ value, onChange }: { value: Where; onChange: (v: Where) => void }) {
  const opts: [Where, string][] = [["trabalho", "Escritório"], ["terminal", "Terminal"], ["casa", "Casa"], [null, "Folga"]];
  return (
    <div className="seg">
      {opts.map(([v, l]) => <button key={l} type="button" className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

function Travel({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <>
      <span>{label}</span>
      <input type="number" inputMode="numeric" min={0} max={300} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} aria-label={`${label} em minutos`} />
    </>
  );
}

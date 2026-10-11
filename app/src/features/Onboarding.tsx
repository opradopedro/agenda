import { useState } from "react";
import { DEFAULT_ROUTINE } from "../data/defaults";
import { applyRoutine, WEEKDAYS, WEEKDAYS_SHORT } from "../data/routine";
import type { AlertMode, RoutineDraft, ScheduleMode, Settings } from "../data/types";

type Where = "trabalho" | "terminal" | "casa" | null;

const STEPS = ["Horários", "Lugares", "Estágio", "Faculdade", "Deslocamentos", "Preferências"];

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
  const [wake, setWake] = useState(settings.wakeTime);
  const [sleep, setSleep] = useState(settings.sleepTime);
  const [r, setR] = useState<RoutineDraft>(() => structuredClone(settings.routine ?? DEFAULT_ROUTINE));
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

  async function finish() {
    setSaving(true);
    await applyRoutine(r, { wakeTime: wake, sleepTime: sleep, quietStart: sleep, scheduleMode: mode, defaultAlertMode: alert, returnHomeInGaps: returnHome });
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
          <div className="grid2">
            <label className="field"><span>Acordo às</span><input type="time" value={wake} onChange={(e) => setWake(e.target.value)} /></label>
            <label className="field"><span>Durmo às</span><input type="time" value={sleep} onChange={(e) => setSleep(e.target.value)} /></label>
          </div>
          <p className="muted small">Nada é agendado entre a hora de dormir e a de acordar, e as notificações ficam em silêncio nesse período.</p>
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
              <div className="grid2">
                <label className="field"><span>Começa</span><input type="time" value={r.internship.start} onChange={(e) => upd((d) => void (d.internship.start = e.target.value))} /></label>
                <label className="field"><span>Termina</span><input type="time" value={r.internship.end} onChange={(e) => upd((d) => void (d.internship.end = e.target.value))} /></label>
              </div>
              <label className="field"><span>Qual é o dia do terminal?</span>
                <select value={terminalDay} onChange={(e) => setTerminalDay(Number(e.target.value))}>
                  <option value={-1}>Não vou ao terminal</option>
                  {[1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{WEEKDAYS[d]}</option>)}
                </select>
              </label>
              <p className="muted small">Onde é o estágio em cada dia (home office = Casa):</p>
              <div className="daygrid">
                {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
                  <Day key={wd} wd={wd} value={r.internship.days[wd] ?? null} onChange={(v) => upd((d) => void (d.internship.days[wd] = v))} />
                ))}
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
              <div className="grid2">
                <label className="field"><span>Começa</span><input type="time" value={r.college.start} onChange={(e) => upd((d) => void (d.college.start = e.target.value))} /></label>
                <label className="field"><span>Termina</span><input type="time" value={r.college.end} onChange={(e) => upd((d) => void (d.college.end = e.target.value))} /></label>
              </div>
              <p className="muted small">Quais dias?</p>
              <div className="row wrap">
                {[1, 2, 3, 4, 5, 6].map((wd) => {
                  const on = r.college.days.includes(wd);
                  return (
                    <button key={wd} type="button" className={`chip ${on ? "on" : ""}`} style={{ padding: "8px 14px", fontSize: "0.9rem" }}
                      onClick={() => upd((d) => void (d.college.days = on ? d.college.days.filter((x) => x !== wd) : [...d.college.days, wd].sort()))}>
                      {WEEKDAYS_SHORT[wd]}
                    </button>
                  );
                })}
              </div>
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

function Day({ wd, value, onChange }: { wd: number; value: Where; onChange: (v: Where) => void }) {
  const opts: [Where, string][] = [["trabalho", "Escritório"], ["terminal", "Terminal"], ["casa", "Casa"], [null, "Folga"]];
  return (
    <>
      <span>{WEEKDAYS[wd]}</span>
      <div className="seg">
        {opts.map(([v, l]) => <button key={l} type="button" className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>)}
      </div>
    </>
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

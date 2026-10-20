import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../data/db";
import { normalizeSettings } from "../data/defaults";
import { saveSettings } from "../data/routine";
import type { AlertMode, Settings as S } from "../data/types";
import { ALERT_LABEL } from "../lib/format";
import { navigate } from "../lib/router";
import { toast } from "../components/Toast";
import { TimeField } from "../components/TimeField";

export function Settings() {
  const s = useLiveQuery(async () => normalizeSettings(await db.settings.get("me")), []);
  if (!s) return null;
  const set = (patch: Partial<S>) => saveSettings(patch);

  return (
    <>
      <header className="top"><h1>Config</h1></header>

      <div className="section-title">Agendamento</div>
      <div className="card stack">
        <div className="seg">
          <button className={s.scheduleMode === "proposta" ? "on" : ""} onClick={() => set({ scheduleMode: "proposta" })}>Mostrar proposta</button>
          <button className={s.scheduleMode === "direto" ? "on" : ""} onClick={() => set({ scheduleMode: "direto" })}>Agendar direto</button>
        </div>
        <span className="small muted">{s.scheduleMode === "proposta" ? "Você aprova ou edita os horários antes de entrarem na agenda." : "As tarefas entram direto na agenda."}</span>
        <label className="field"><span>Aviso padrão das tarefas</span>
          <div className="seg">
            {(["lembrete", "alarme", "nenhum"] as AlertMode[]).map((a) => (
              <button key={a} className={s.defaultAlertMode === a ? "on" : ""} onClick={() => set({ defaultAlertMode: a })}>{ALERT_LABEL[a]}</button>
            ))}
          </div></label>
      </div>

      <div className="section-title">Rotina</div>
      <div className="card stack">
        <div className="small muted">
          {s.routine.sleep.sameTime
            ? `Acorda ${s.routine.sleep.wake ?? "sem horário fixo"} · dorme ${s.routine.sleep.sleep ?? "sem horário fixo"}`
            : "Horários de acordar e dormir diferentes por dia"}
          . Estágio, faculdade, lugares e deslocamentos.
        </div>
        <div className="row wrap">
          <button className="btn" onClick={() => navigate("rotina")}>Editar rotina</button>
          <button className="btn" onClick={() => navigate("rotinas")}>Rotinas recorrentes</button>
        </div>
      </div>

      <div className="section-title">Notificações</div>
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>As notificações começam a funcionar na Fase 2 (computador) e na Fase 3 (Android). As escolhas já ficam salvas.</p>
        <Toggle label="Silêncio enquanto durmo" hint="Segue o horário de dormir e acordar de cada dia" checked={s.quietStart === null}
          onChange={(v) => set(v ? { quietStart: null, quietEnd: null } : { quietStart: "00:00", quietEnd: "07:00" })} />
        {s.quietStart !== null && (
          <div className="row wrap" style={{ padding: "4px 0 10px" }}>
            <span className="small muted">Silêncio das</span>
            <TimeField label="Silêncio a partir de" value={s.quietStart} onChange={(v) => set({ quietStart: v ?? "00:00" })} />
            <span className="small muted">às</span>
            <TimeField label="Silêncio até" value={s.quietEnd ?? "07:00"} onChange={(v) => set({ quietEnd: v ?? "07:00" })} />
          </div>
        )}
        <Toggle label="Modo silencioso" hint="Notifica sem som e sem vibrar" checked={s.silentMode} onChange={(v) => set({ silentMode: v })} />
        <Toggle label="Aviso no início da tarefa" checked={s.notifyStart} onChange={(v) => set({ notifyStart: v })} />
        <Toggle label="Check-in no fim da tarefa" hint="Terminei · Mais tempo · Remarcar" checked={s.notifyEnd} onChange={(v) => set({ notifyEnd: v })} />
        <Toggle label="Nova proposta pronta" checked={s.notifyProposal} onChange={(v) => set({ notifyProposal: v })} />
        <div className="grid2" style={{ marginTop: 8 }}>
          <label className="field"><span>Avisar quantos min antes</span>
            <input type="number" inputMode="numeric" min={0} max={120} value={s.reminderLeadMin} onChange={(e) => set({ reminderLeadMin: Math.max(0, Number(e.target.value) || 0) })} /></label>
          <label className="field"><span>"Mais tempo" padrão (min)</span>
            <input type="number" inputMode="numeric" min={5} max={120} step={5} value={s.moreTimeDefaultMin} onChange={(e) => set({ moreTimeDefaultMin: Math.max(5, Number(e.target.value) || 15) })} /></label>
        </div>
      </div>

      <div className="section-title">Agendador</div>
      <div className="card">
        <Toggle label="Voltar para casa entre compromissos" hint="Só quando sobrar tempo suficiente em casa" checked={s.returnHomeInGaps} onChange={(v) => set({ returnHomeInGaps: v })} />
        <div className="grid2" style={{ marginTop: 8 }}>
          <label className="field"><span>Intervalo entre tarefas (min)</span>
            <input type="number" inputMode="numeric" min={0} max={60} value={s.taskBufferMin} onChange={(e) => set({ taskBufferMin: Math.max(0, Number(e.target.value) || 0) })} /></label>
          <label className="field"><span>Evitar tarefas depois de</span>
            <TimeField label="Evitar tarefas depois de" value={s.lateHour} onChange={(v) => set({ lateHour: v ?? "22:00" })} /></label>
          <label className="field"><span>Ida e volta p/ recado saindo de casa (min)</span>
            <input type="number" inputMode="numeric" min={0} max={180} value={s.errandFromHomeOverheadMin} onChange={(e) => set({ errandFromHomeOverheadMin: Math.max(0, Number(e.target.value) || 0) })} /></label>
          <label className="field"><span>Planejar quantos dias à frente</span>
            <input type="number" inputMode="numeric" min={3} max={28} value={s.horizonDays} onChange={(e) => set({ horizonDays: Math.min(28, Math.max(3, Number(e.target.value) || 14)) })} /></label>
        </div>
      </div>

      <div className="section-title">Dados</div>
      <div className="card stack">
        <span className="small muted">Na Fase 1 tudo fica só neste aparelho. Na Fase 2 passa a sincronizar com a nuvem.</span>
        <div className="row wrap">
          <button className="btn" onClick={exportData}>Exportar (JSON)</button>
          <button className="btn danger" onClick={wipe}>Apagar tudo</button>
        </div>
      </div>
      <p className="small muted" style={{ textAlign: "center", marginTop: 24 }}>Agenda · Fase 1</p>
    </>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch-row">
      <span className="label">{label}{hint && <small>{hint}</small>}</span>
      <input type="checkbox" className="toggle" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

async function exportData() {
  const dump: Record<string, unknown> = {};
  for (const t of db.tables) dump[t.name] = await t.toArray();
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `agenda-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function wipe() {
  if (!confirm("Apagar todas as tarefas, rotina e configurações deste aparelho?")) return;
  await Promise.all(db.tables.map((t) => t.clear()));
  toast("Dados apagados.");
  location.hash = "";
  location.reload();
}

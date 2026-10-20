// Android: permissões para os avisos chegarem na hora, mesmo com a tela
// desligada, e guia por fabricante para a otimização de bateria.
import { useCallback, useEffect, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import { AgendaNative, rescheduleNative, type NativeStatus } from "../lib/native";
import { IconBack } from "../components/Icons";
import { toast } from "../components/Toast";
import { navigate } from "../lib/router";

const TIPS: [RegExp, string, string[]][] = [
  [/xiaomi|redmi|poco/i, "Xiaomi / Redmi / POCO", [
    "Configurações → Apps → Gerenciar apps → Agenda → Economia de bateria: Sem restrições.",
    "No mesmo lugar, ligue Inicialização automática.",
    "Em Apps recentes, segure o Agenda e toque no cadeado para não ser fechado.",
  ]],
  [/samsung/i, "Samsung", [
    "Configurações → Bateria → Limites de uso em segundo plano → Apps que nunca entram em suspensão → adicione o Agenda.",
    "Configurações → Apps → Agenda → Bateria: Sem restrições.",
  ]],
  [/motorola|lenovo/i, "Motorola", [
    "Configurações → Apps → Agenda → Bateria: Sem restrições (ou Otimização desativada).",
  ]],
  [/oppo|realme|oneplus/i, "OPPO / realme / OnePlus", [
    "Configurações → Bateria → Mais configurações → Otimizar uso da bateria → Agenda: Não otimizar.",
    "Configurações → Apps → Agenda → Uso da bateria: permitir atividade em segundo plano e inicialização automática.",
  ]],
  [/huawei|honor/i, "Huawei / Honor", [
    "Configurações → Bateria → Inicialização de apps → Agenda: gerenciar manualmente e ligar as três opções.",
  ]],
];

export function AndroidSetup() {
  const [s, setS] = useState<NativeStatus | null>(null);
  const refresh = useCallback(() => AgendaNative.status().then(setS).catch(() => setS(null)), []);
  useEffect(() => {
    refresh();
    // voltou das configurações do Android: atualiza o status
    const h = CapApp.addListener("resume", refresh);
    return () => void h.then((x) => x.remove());
  }, [refresh]);

  const tip = s ? TIPS.find(([re]) => re.test(s.manufacturer)) : undefined;
  const Row = ({ ok, title, desc, action, label }: { ok: boolean; title: string; desc: string; action: () => void; label: string }) => (
    <div className="switch-row">
      <span className="label">{ok ? "✅" : "⚠️"} {title}<small>{desc}</small></span>
      {!ok && <button className="btn primary" onClick={action}>{label}</button>}
    </div>
  );

  return (
    <div className="app bare">
      <div className="sheet-head">
        <button className="icon-btn" aria-label="Voltar" onClick={() => navigate("config")}><IconBack /></button>
        <h2>Avisos no Android</h2>
      </div>
      {!s ? (
        <p className="muted">Disponível só no app instalado.</p>
      ) : (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>
            Para os lembretes chegarem no minuto certo, mesmo com a tela desligada, libere os itens abaixo. "Alarme exato" é só o nome da
            permissão de agendar no horário certo: não faz o celular tocar como despertador.
          </p>
          <div className="card">
            <Row ok={s.notifications === "granted"} title="Notificações" desc="Permite mostrar os avisos"
              label="Permitir" action={() => AgendaNative.requestNotifications().then(() => s.notifications === "denied" ? AgendaNative.openNotificationSettings() : undefined).then(refresh)} />
            <Row ok={s.exactAlarms} title="Alarmes e lembretes" desc="Avisos no minuto exato" label="Abrir" action={() => AgendaNative.openExactAlarmSettings()} />
            <Row ok={s.batteryUnrestricted} title="Bateria sem restrições" desc="O Android não adia nem cancela os avisos" label="Liberar" action={() => AgendaNative.requestIgnoreBattery()} />
            <Row ok={s.fullScreen} title="Tela cheia (só para alarmes)" desc="Tarefas marcadas como alarme aparecem por cima da tela de bloqueio" label="Abrir" action={() => AgendaNative.openFullScreenSettings()} />
          </div>

          {tip && (
            <>
              <div className="section-title">No seu {tip[1]}</div>
              <div className="card">
                <ol style={{ margin: 0, paddingLeft: 18 }} className="small">
                  {tip[2].map((t) => <li key={t} style={{ marginBottom: 6 }}>{t}</li>)}
                </ol>
                <button className="btn" style={{ marginTop: 8 }} onClick={() => AgendaNative.openAppSettings()}>Abrir configurações do app</button>
              </div>
            </>
          )}

          <div className="section-title">Testar</div>
          <div className="card stack">
            <span className="small muted">Chega em 10 segundos. Bloqueie a tela para ver como fica.</span>
            <div className="row">
              <button className="btn" onClick={() => AgendaNative.testNotification({ alarm: false, seconds: 10 }).then(() => toast("Lembrete de teste em 10 s."))}>Lembrete</button>
              <button className="btn" onClick={() => AgendaNative.testNotification({ alarm: true, seconds: 10 }).then(() => toast("Alarme de teste em 10 s."))}>Alarme</button>
              <button className="btn ghost" onClick={() => rescheduleNative().then((n) => toast(`${n} aviso(s) agendado(s) para os próximos 7 dias.`))}>Reagendar</button>
            </div>
          </div>
          <p className="small muted">{s.manufacturer} {s.model} · Android API {s.sdk}</p>
        </>
      )}
    </div>
  );
}

/** Algo impede os avisos de chegar? (para o aviso na tela Hoje) */
export async function androidNeedsSetup(): Promise<boolean> {
  try {
    const s = await AgendaNative.status();
    return s.notifications !== "granted" || !s.exactAlarms || !s.batteryUnrestricted;
  } catch {
    return false;
  }
}

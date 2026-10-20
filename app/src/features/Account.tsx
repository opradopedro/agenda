// Config → Conta e nuvem: login Google, sincronização, Google Calendar e
// notificações neste computador.
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { saveSettings } from "../data/routine";
import { onSyncState, syncNow, syncState, type SyncState } from "../data/sync";
import type { Settings } from "../data/types";
import { toast } from "../components/Toast";
import { callFunction } from "../lib/api";
import { fmtWhen } from "../lib/format";
import { currentSubscription, disablePush, enablePush, pushSupported, sendTestPush } from "../lib/push";
import { signInWithGoogle, signOut, supabase } from "../lib/supabase";

export function AccountSection({ s }: { s: Settings }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sync, setSync] = useState<SyncState>(syncState());
  const [google, setGoogle] = useState<{ connected: boolean; last_synced_at: string | null } | null>(null);
  const [push, setPush] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s2) => setSession(s2));
    const off = onSyncState(setSync);
    return () => {
      data.subscription.unsubscribe();
      off();
    };
  }, []);

  useEffect(() => {
    if (!session || !supabase) return;
    supabase.rpc("google_status").then(({ data }) => setGoogle(data as typeof google));
    currentSubscription().then((sub) => setPush(!!sub)).catch(() => setPush(false));
  }, [session, sync.lastAt]);

  if (!supabase) {
    return <p className="small muted">Nuvem não configurada nesta versão do app: os dados ficam só neste aparelho.</p>;
  }

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return (
      <div className="stack">
        <span className="small muted">
          Entre com o Google para guardar tudo na nuvem, usar no celular e no computador, e ligar o Google Calendar (as tarefas aparecem lá sem
          notificação; seus eventos viram compromissos fixos).
        </span>
        <button className="btn primary" disabled={busy} onClick={() => run(signInWithGoogle)}>Entrar com Google</button>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row">
        <span style={{ flex: 1 }}><b>{session.user.email}</b><br />
          <span className="small muted">
            {sync.running ? "Sincronizando…" : sync.error ? `Erro: ${sync.error}` : sync.lastAt ? `Sincronizado ${fmtWhen(sync.lastAt).toLowerCase()}` : "Ainda não sincronizado"}
          </span>
        </span>
        <button className="btn" disabled={sync.running} onClick={() => syncNow()}>Sincronizar</button>
      </div>

      <div className="switch-row" style={{ borderTop: "1px solid var(--line)" }}>
        <span className="label">Google Calendar
          <small>{google?.connected ? `Conectado${google.last_synced_at ? ` · última leitura ${fmtWhen(google.last_synced_at).toLowerCase()}` : ""}` : "Não conectado: entre de novo para autorizar"}</small>
        </span>
        {google?.connected ? (
          <button className="btn" disabled={busy} onClick={() => run(async () => { await callFunction("gcal-sync", {}); await syncNow(); }, "Calendar sincronizado.")}>Agora</button>
        ) : (
          <button className="btn primary" disabled={busy} onClick={() => run(signInWithGoogle)}>Conectar</button>
        )}
      </div>
      <label className="switch-row">
        <span className="label">Lembrete do Google nos eventos<small>Desligado: os eventos do "Agenda IA" não notificam</small></span>
        <input type="checkbox" className="toggle" checked={s.gcalReminders} onChange={(e) => saveSettings({ gcalReminders: e.target.checked })} />
      </label>

      {pushSupported() && (
        <label className="switch-row">
          <span className="label">Notificações neste computador<small>Início e fim das tarefas, com botões</small></span>
          <input type="checkbox" className="toggle" checked={!!push} disabled={busy || push === null}
            onChange={(e) => run(async () => { if (e.target.checked) await enablePush(); else await disablePush(); setPush(e.target.checked); })} />
        </label>
      )}
      {push && <button className="btn" disabled={busy} onClick={() => run(async () => { const r = await sendTestPush(); if (!r.sent) throw new Error("Nenhuma notificação entregue."); }, "Notificação de teste enviada.")}>Enviar notificação de teste</button>}

      <button className="btn ghost danger" onClick={() => run(signOut, "Você saiu. Os dados continuam neste aparelho.")}>Sair</button>
    </div>
  );
}

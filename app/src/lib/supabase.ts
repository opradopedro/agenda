// Cliente do Supabase (login e nuvem). Sem as variáveis de ambiente, o app
// segue funcionando só no aparelho.
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { callFunction, setTokenProvider } from "./api";

const URL_BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  URL_BASE && ANON
    ? createClient(URL_BASE, ANON, { auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true, autoRefreshToken: true } })
    : null;

export const cloudAvailable = () => supabase !== null;

let current: Session | null = null;
export const currentSession = () => current;

if (supabase) {
  setTokenProvider(async () => (await supabase.auth.getSession()).data.session?.access_token ?? null);
  supabase.auth.getSession().then(({ data }) => (current = data.session));
  supabase.auth.onAuthStateChange((_e, s) => {
    current = s;
    // só vem no retorno do login com Google: guarda para o Calendar no servidor
    if (s?.provider_refresh_token) {
      callFunction("google-connect", { refresh_token: s.provider_refresh_token, scopes: GOOGLE_SCOPES.split(" ") }).catch((e) =>
        console.warn("google-connect:", e),
      );
    }
  });
}

/** Escopo do Calendar: ler compromissos e criar/editar o calendário "Agenda IA". */
export const GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar";

export function redirectUrl(): string {
  // no Android (Fase 3) o retorno é pelo esquema do app
  const native = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  return native ? "com.opradopedro.agenda://login-callback" : `${location.origin}${location.pathname}`;
}

export async function signInWithGoogle(): Promise<void> {
  if (!supabase) throw new Error("Nuvem não configurada neste app.");
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectUrl(),
      scopes: GOOGLE_SCOPES,
      // offline + consent: o Google devolve o refresh token (Calendar no servidor)
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}

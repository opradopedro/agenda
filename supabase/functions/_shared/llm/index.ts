// Ponto único de entrada do LLM. Configuração por variáveis de ambiente:
//   LLM_PROVIDER        gemini (padrão)
//   LLM_MODEL           modelo principal          (padrão gemini-3.5-flash)
//   LLM_FALLBACK_MODEL  usado em cota/tempo/erro  (padrão gemini-3.5-flash-lite)
//   GEMINI_API_KEY
import { GeminiProvider } from "./gemini.ts";
import { LLMError, type LLMProvider, type LLMRequest, type LLMResult } from "./types.ts";

export * from "./types.ts";

type Env = (k: string) => string | undefined;

export function createLLM(env: Env) {
  const providerName = env("LLM_PROVIDER") ?? "gemini";
  let provider: LLMProvider;
  switch (providerName) {
    case "gemini": {
      const key = env("GEMINI_API_KEY");
      if (!key) throw new Error("GEMINI_API_KEY não configurada");
      provider = new GeminiProvider(key);
      break;
    }
    default:
      throw new Error(`provedor de LLM desconhecido: ${providerName}`);
  }
  const models = [env("LLM_MODEL") ?? "gemini-3.5-flash", env("LLM_FALLBACK_MODEL") ?? "gemini-3.5-flash-lite"]
    .filter((m, i, a) => m && a.indexOf(m) === i);

  return {
    provider: provider.name,
    /** Tenta o modelo principal; em cota, tempo esgotado ou erro do provedor, o fallback. */
    async generateJSON<T>(req: LLMRequest, onAttempt?: (r: { model: string; ok: boolean; error?: string; usage?: LLMResult<T>["usage"] }) => void): Promise<LLMResult<T>> {
      let last: unknown;
      for (const model of models) {
        try {
          const r = await provider.generateJSON<T>(req, model);
          onAttempt?.({ model, ok: true, usage: r.usage });
          return r;
        } catch (e) {
          last = e;
          onAttempt?.({ model, ok: false, error: (e as Error).message });
          if (!(e instanceof LLMError) || e.kind === "invalid") throw e;
        }
      }
      throw last;
    },
  };
}

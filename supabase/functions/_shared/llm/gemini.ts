import { LLMError, type LLMProvider, type LLMRequest, type LLMResult } from "./types.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Converte o schema genérico (tipos minúsculos) para o formato do Gemini. */
function toGeminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (k === "type" && typeof v === "string") out.type = v.toUpperCase();
    else if (k === "properties" && v && typeof v === "object") {
      out.properties = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, toGeminiSchema(pv)]),
      );
    } else out[k] = toGeminiSchema(v);
  }
  return out;
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  constructor(private apiKey: string) {}

  async generateJSON<T>(req: LLMRequest, model: string): Promise<LLMResult<T>> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 30000);
    let res: Response;
    try {
      res = await fetch(`${BASE}/${model}:generateContent`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.user }] }],
          generationConfig: {
            // modelos 3.x "pensam" antes de responder; para extrair JSON, pouco basta
            ...(/^gemini-3/.test(model) ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
            temperature: req.temperature ?? 0.2,
            responseMimeType: "application/json",
            responseSchema: toGeminiSchema(req.jsonSchema),
          },
        }),
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new LLMError("tempo esgotado", "timeout", model);
      throw new LLMError(String(e), "provider", model);
    } finally {
      clearTimeout(timer);
    }

    const body = await res.json().catch(() => ({}));
    if (res.status === 429) throw new LLMError("cota do Gemini esgotada", "quota", model);
    if (!res.ok) {
      throw new LLMError(body?.error?.message ?? `HTTP ${res.status}`, "provider", model);
    }
    const text: string | undefined = body?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("");
    if (!text) throw new LLMError("resposta vazia", "invalid", model);
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      throw new LLMError("resposta não é JSON", "invalid", model);
    }
    return {
      data,
      provider: this.name,
      model: body?.modelVersion ?? model,
      usage: {
        inputTokens: body?.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: body?.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}

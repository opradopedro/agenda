// Interface única para qualquer provedor de LLM. Trocar de provedor = criar
// outro arquivo que implemente LLMProvider e registrá-lo em index.ts.

export interface LLMRequest {
  system: string;
  user: string;
  /** Schema da resposta (subconjunto OpenAPI: type, properties, items, enum, nullable, required). */
  jsonSchema: Record<string, unknown>;
  temperature?: number;
  timeoutMs?: number;
}

export interface LLMResult<T> {
  data: T;
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LLMProvider {
  readonly name: string;
  generateJSON<T>(req: LLMRequest, model: string): Promise<LLMResult<T>>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly kind: "quota" | "timeout" | "invalid" | "provider",
    readonly model?: string,
  ) {
    super(message);
  }
}

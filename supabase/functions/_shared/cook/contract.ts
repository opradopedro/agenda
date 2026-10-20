// Modo cozinha: receitas sugeridas pela IA (schema + prompt + validação) e a
// lista de compras consolidada (código determinístico, não a IA).

export const SECTIONS = ["hortifruti", "acougue", "frios_laticinios", "mercearia", "padaria", "congelados", "outros"] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_LABEL: Record<Section, string> = {
  hortifruti: "Hortifrúti",
  acougue: "Açougue",
  frios_laticinios: "Frios e laticínios",
  mercearia: "Mercearia",
  padaria: "Padaria",
  congelados: "Congelados",
  outros: "Outros",
};

export interface Ingredient {
  name: string;
  qty: number | null;
  unit: string | null;
  section: Section;
}

export interface SuggestedRecipe {
  title: string;
  servings: number;
  prep_min: number; // tempo total, do início ao fim
  active_min: number; // tempo de mão na massa
  ingredients: Ingredient[];
  steps: string[];
  health_notes: string | null;
}

export interface CookRequest {
  request: string; // ex.: "Fazer marmitas e patê de frango para a semana"
  servings: number;
  preferences: string;
  count: number;
}

const nstr = { type: "string", nullable: true };

export const COOK_SCHEMA = {
  type: "object",
  properties: {
    recipes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          servings: { type: "integer" },
          prep_min: { type: "integer", description: "tempo total em minutos" },
          active_min: { type: "integer", description: "minutos de trabalho ativo" },
          ingredients: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "nome simples no singular, ex.: cebola" },
                qty: { type: "number", nullable: true },
                unit: { type: "string", nullable: true, description: "g, kg, ml, l, un, colher, xícara ou null" },
                section: { type: "string", enum: [...SECTIONS] },
              },
              required: ["name", "qty", "unit", "section"],
            },
          },
          steps: { type: "array", items: { type: "string" } },
          health_notes: nstr,
        },
        required: ["title", "servings", "prep_min", "active_min", "ingredients", "steps", "health_notes"],
      },
    },
  },
  required: ["recipes"],
};

export function buildCookPrompt(r: CookRequest): { system: string; user: string } {
  return {
    system: `Você é nutricionista e cozinheiro prático no Brasil. Sugira receitas SAUDÁVEIS, baratas e fáceis para preparo da semana (marmitas que aguentam geladeira/freezer), com ingredientes comuns em mercado brasileiro.
Regras:
- Cubra o que foi pedido. Se o pedido citar pratos específicos (ex.: "patê de frango"), inclua uma receita para cada um.
- Nome do ingrediente como se compra no mercado, cru e sem preparo (ex.: "peito de frango", não "frango cozido desfiado"), para a lista de compras somar itens iguais entre receitas.
- Quantidades realistas para o número de porções pedido, em g, kg, ml, l ou un (use colher/xícara só para temperos). Sal e temperos a gosto: qty null.
- prep_min: tempo total real; active_min: tempo com a mão na massa.
- Passos curtos e objetivos, em ordem. Indique como armazenar e por quantos dias no último passo.
- health_notes: uma frase sobre por que é saudável.
- Respeite as preferências e restrições.`,
    user: `Pedido: ${r.request}
Porções: ${r.servings}
Preferências/restrições: ${r.preferences || "nenhuma"}
Quantidade de opções: ${r.count}`,
  };
}

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const str = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export function validateRecipes(raw: unknown): SuggestedRecipe[] {
  const list = (raw as { recipes?: unknown })?.recipes;
  if (!Array.isArray(list)) throw new Error("resposta sem receitas");
  const out: SuggestedRecipe[] = [];
  for (const r of list as Record<string, unknown>[]) {
    const title = str(r?.title, 120);
    if (!title || !Array.isArray(r.ingredients) || !Array.isArray(r.steps)) continue;
    const prep = clamp(r.prep_min, 5, 600, 60);
    const ingredients: Ingredient[] = [];
    for (const i of r.ingredients as Record<string, unknown>[]) {
      const name = str(i?.name, 80);
      if (!name) continue;
      const q = Number(i.qty);
      ingredients.push({
        name,
        qty: i.qty === null || !Number.isFinite(q) || q <= 0 ? null : Math.round(q * 100) / 100,
        unit: str(i.unit, 20),
        section: (SECTIONS as readonly string[]).includes(i.section as string) ? (i.section as Section) : "outros",
      });
    }
    if (!ingredients.length) continue;
    out.push({
      title,
      servings: clamp(r.servings, 1, 50, 4),
      prep_min: prep,
      active_min: Math.min(prep, clamp(r.active_min, 5, 600, prep)),
      ingredients,
      steps: (r.steps as unknown[]).map((s) => str(s, 500)).filter((s): s is string => !!s).slice(0, 20),
      health_notes: str(r.health_notes, 300),
    });
  }
  if (!out.length) throw new Error("nenhuma receita válida");
  return out;
}

// ---------------------------------------------------------------------------
// lista de compras e duração (determinísticos)
// ---------------------------------------------------------------------------

const UNIT_ALIASES: Record<string, { unit: string; factor: number }> = {
  g: { unit: "g", factor: 1 }, grama: { unit: "g", factor: 1 }, gramas: { unit: "g", factor: 1 },
  kg: { unit: "g", factor: 1000 }, quilo: { unit: "g", factor: 1000 }, quilos: { unit: "g", factor: 1000 },
  ml: { unit: "ml", factor: 1 }, l: { unit: "ml", factor: 1000 }, litro: { unit: "ml", factor: 1000 }, litros: { unit: "ml", factor: 1000 },
  un: { unit: "un", factor: 1 }, unidade: { unit: "un", factor: 1 }, unidades: { unit: "un", factor: 1 },
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export interface ShoppingLine {
  key: string;
  name: string;
  qty: number | null;
  unit: string | null;
  section: Section;
  /** índices das receitas de origem */
  sources: number[];
}

/** Junta ingredientes iguais (mesmo nome e unidade compatível) somando as quantidades. */
export function consolidate(recipes: { ingredients: Ingredient[] }[]): ShoppingLine[] {
  const map = new Map<string, ShoppingLine>();
  recipes.forEach((r, ri) => {
    for (const ing of r.ingredients) {
      const alias = ing.unit ? UNIT_ALIASES[norm(ing.unit)] : undefined;
      const unit = alias?.unit ?? ing.unit;
      const qty = ing.qty === null ? null : ing.qty * (alias?.factor ?? 1);
      const key = `${norm(ing.name)}|${qty === null ? "agosto" : norm(unit ?? "")}`;
      const cur = map.get(key);
      if (cur) {
        if (cur.qty !== null && qty !== null) cur.qty += qty;
        if (!cur.sources.includes(ri)) cur.sources.push(ri);
      } else {
        map.set(key, { key, name: ing.name, qty, unit, section: ing.section, sources: [ri] });
      }
    }
  });
  const order = (s: Section) => SECTIONS.indexOf(s);
  return [...map.values()]
    .map((l) => (l.unit === "g" && l.qty !== null && l.qty >= 1000 ? { ...l, qty: l.qty / 1000, unit: "kg" } : l.unit === "ml" && l.qty !== null && l.qty >= 1000 ? { ...l, qty: l.qty / 1000, unit: "l" } : l))
    .sort((a, b) => order(a.section) - order(b.section) || a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * Tempo para cozinhar várias receitas no mesmo período: o trabalho ativo soma,
 * as esperas (forno, panela de pressão) se sobrepõem.
 */
export function cookingDuration(recipes: { prep_min: number; active_min: number }[]): number {
  if (!recipes.length) return 0;
  const active = recipes.reduce((a, r) => a + r.active_min, 0);
  const waiting = Math.max(...recipes.map((r) => r.prep_min - r.active_min));
  return Math.max(5, Math.ceil((active + waiting) / 5) * 5);
}

export function fmtQty(qty: number | null, unit: string | null): string {
  if (qty === null) return "a gosto";
  const n = Number.isInteger(qty) ? String(qty) : qty.toFixed(qty < 10 ? 2 : 1).replace(/\.?0+$/, "").replace(".", ",");
  return unit ? `${n} ${unit}` : n;
}

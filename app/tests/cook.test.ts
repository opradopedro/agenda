import { describe, expect, it } from "vitest";
import { consolidate, cookingDuration, fmtQty } from "../../supabase/functions/_shared/cook/contract.ts";

describe("lista de compras", () => {
  it("soma ingredientes iguais, convertendo kg/g e ignorando acento e maiúsculas", () => {
    const lines = consolidate([
      { ingredients: [{ name: "Peito de frango", qty: 1, unit: "kg", section: "acougue" }, { name: "Cebola", qty: 2, unit: "un", section: "hortifruti" }] },
      { ingredients: [{ name: "peito de frango", qty: 500, unit: "g", section: "acougue" }, { name: "cebola", qty: 1, unit: "un", section: "hortifruti" }, { name: "Sal", qty: null, unit: null, section: "mercearia" }] },
    ]);
    const by = Object.fromEntries(lines.map((l) => [l.name.toLowerCase(), l]));
    expect(by["peito de frango"]).toMatchObject({ qty: 1.5, unit: "kg", sources: [0, 1] });
    expect(by["cebola"]).toMatchObject({ qty: 3, unit: "un" });
    expect(fmtQty(by["sal"].qty, by["sal"].unit)).toBe("a gosto");
    // ordenado por seção: hortifrúti antes do açougue
    expect(lines[0].section).toBe("hortifruti");
  });

  it("unidades diferentes não se misturam", () => {
    const lines = consolidate([{ ingredients: [{ name: "azeite", qty: 2, unit: "colher", section: "mercearia" }, { name: "azeite", qty: 100, unit: "ml", section: "mercearia" }] }]);
    expect(lines).toHaveLength(2);
  });
});

describe("duração do preparo", () => {
  it("soma o trabalho ativo e sobrepõe as esperas", () => {
    // 15 ativo + 25 forno; 20 ativo + 25 panela; 15 ativo → 50 ativo + 25 espera
    expect(cookingDuration([{ prep_min: 40, active_min: 15 }, { prep_min: 45, active_min: 20 }, { prep_min: 15, active_min: 15 }])).toBe(75);
  });
});

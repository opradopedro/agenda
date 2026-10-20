// Modo cozinha: guarda as receitas escolhidas, monta a lista de compras e
// ajusta a duração da etapa de cozinhar.
import { consolidate, cookingDuration, type SuggestedRecipe } from "@shared/cook/contract.ts";
import { db, newId, nowIso } from "./db";
import { refreshTaskSchedule, type PlanOutcome } from "./planner";
import type { Recipe, ShoppingItem, Task } from "./types";

/** Tarefa raiz (a que tem as etapas) de uma tarefa de cozinha. */
export async function cookingRoot(taskId: string): Promise<Task | undefined> {
  const t = await db.tasks.get(taskId);
  return t?.parentId ? db.tasks.get(t.parentId) : t;
}

/** Etapa que recebe o tempo das receitas: "cozinhar"/"preparar" em casa, ou a própria tarefa. */
export async function cookingStep(root: Task): Promise<Task> {
  const kids = (await db.tasks.where("parentId").equals(root.id).toArray()).sort((a, b) => a.seq - b.seq);
  if (!kids.length) return root;
  return kids.find((k) => /cozinh|prepar|fazer|assar|refog/i.test(k.title) && k.location !== "rua") ?? kids.find((k) => k.location === "casa") ?? root;
}

/** Etapa de compras (recebe a lista), se houver. */
export async function shoppingStep(root: Task): Promise<Task | undefined> {
  const kids = await db.tasks.where("parentId").equals(root.id).toArray();
  return kids.find((k) => /compr|mercado|feira/i.test(k.title)) ?? kids.find((k) => k.location === "rua");
}

export async function chooseRecipes(rootId: string, chosen: SuggestedRecipe[]): Promise<{ durationMin: number; outcome: PlanOutcome | null }> {
  const root = await db.tasks.get(rootId);
  if (!root) throw new Error("tarefa não encontrada");
  const ts = nowIso();
  const recipes: Recipe[] = chosen.map((r) => ({
    id: newId(),
    taskId: rootId,
    title: r.title,
    servings: r.servings,
    prepMin: r.prep_min,
    activeMin: r.active_min,
    ingredients: r.ingredients,
    steps: r.steps,
    healthNotes: r.health_notes,
    chosen: true,
    createdAt: ts,
    updatedAt: ts,
  }));
  const lines = consolidate(chosen);
  const durationMin = cookingDuration(chosen);
  const step = await cookingStep(root);
  const shop = await shoppingStep(root);

  await db.transaction("rw", [db.recipes, db.shoppingLists, db.shoppingItems, db.tasks], async () => {
    // troca as receitas e a lista anteriores desta tarefa
    const oldLists = await db.shoppingLists.where("taskId").equals(rootId).toArray();
    for (const l of oldLists) await db.shoppingItems.where("listId").equals(l.id).delete();
    await db.shoppingLists.where("taskId").equals(rootId).delete();
    await db.recipes.where("taskId").equals(rootId).delete();
    await db.recipes.bulkAdd(recipes);
    const listId = newId();
    await db.shoppingLists.add({ id: listId, taskId: rootId, title: `Compras · ${root.title}`, createdAt: ts, updatedAt: ts });
    const items: ShoppingItem[] = lines.map((l) => ({
      id: newId(),
      listId,
      name: l.name,
      qty: l.qty,
      unit: l.unit,
      section: l.section,
      recipeIds: l.sources.map((i) => recipes[i].id),
      checked: false,
      updatedAt: ts,
    }));
    await db.shoppingItems.bulkAdd(items);
    await db.tasks.update(step.id, { durationMin, isCooking: true });
    if (shop) await db.tasks.update(shop.id, { notes: `Lista de compras: ${lines.length} itens (veja no modo cozinha)` });
    // pai com etapas: duração = soma das etapas
    if (step.id !== root.id) {
      const kids = await db.tasks.where("parentId").equals(root.id).toArray();
      await db.tasks.update(root.id, { durationMin: kids.reduce((a, k) => a + (k.id === step.id ? durationMin : k.durationMin), 0) });
    }
  });
  const outcome = step.durationMin !== durationMin ? await refreshTaskSchedule(step.id) : null;
  return { durationMin, outcome };
}

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { fmtQty, SECTION_LABEL, type Section, type SuggestedRecipe } from "@shared/cook/contract.ts";
import { chooseRecipes, cookingRoot, cookingStep } from "../data/cooking";
import { db } from "../data/db";
import { IconBack } from "../components/Icons";
import { toast } from "../components/Toast";
import { suggestRecipes } from "../lib/api";
import { fmtDur } from "../lib/format";
import { navigate } from "../lib/router";

export function Cooking({ taskId }: { taskId: string }) {
  const data = useLiveQuery(async () => {
    const root = await cookingRoot(taskId);
    if (!root) return null;
    const step = await cookingStep(root);
    const recipes = await db.recipes.where("taskId").equals(root.id).toArray();
    const list = await db.shoppingLists.where("taskId").equals(root.id).first();
    const items = list ? await db.shoppingItems.where("listId").equals(list.id).toArray() : [];
    return { root, step, recipes, list, items };
  }, [taskId]);
  const [servings, setServings] = useState(5);
  const [prefs, setPrefs] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<SuggestedRecipe[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [planId, setPlanId] = useState<string | null>(null);

  if (data === undefined) return null;
  if (data === null) return <div className="app bare"><div className="empty">Tarefa não encontrada.</div></div>;
  const { root, step, recipes, items } = data;
  const showPicker = changing || recipes.length === 0;

  async function suggest() {
    setBusy(true);
    setError(null);
    try {
      const r = await suggestRecipes([root.title, root.notes].filter(Boolean).join(". "), servings, prefs);
      setOptions(r.recipes);
      setPicked(new Set(r.recipes.map((_, i) => i)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function use() {
    if (!options) return;
    setBusy(true);
    try {
      const chosen = options.filter((_, i) => picked.has(i));
      const r = await chooseRecipes(root.id, chosen);
      setOptions(null);
      setChanging(false);
      toast(`"${step.title}" agora dura ${fmtDur(r.durationMin)}.`);
      setPlanId(r.outcome?.mode === "proposta" ? r.outcome.planId : null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const bySection = new Map<string, typeof items>();
  for (const it of items) bySection.set(it.section, [...(bySection.get(it.section) ?? []), it]);
  const pending = items.filter((i) => !i.checked).length;

  return (
    <div className="app bare">
      <div className="sheet-head">
        <button className="icon-btn" aria-label="Voltar" onClick={() => (history.length > 1 ? history.back() : navigate("hoje"))}><IconBack /></button>
        <h2>Modo cozinha</h2>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>{root.title}</p>

      {showPicker && (
        <div className="card stack">
          <div className="grid2">
            <label className="field"><span>Porções</span>
              <input type="number" inputMode="numeric" min={1} max={30} value={servings} onChange={(e) => setServings(Math.max(1, Number(e.target.value) || 1))} /></label>
          </div>
          <label className="field"><span>Preferências ou restrições (opcional)</span>
            <input type="text" placeholder="ex.: sem lactose, frango e batata-doce, barato" value={prefs} onChange={(e) => setPrefs(e.target.value)} /></label>
          <button className="btn primary" disabled={busy} onClick={suggest}>{busy && !options ? "Pensando em receitas…" : options ? "Sugerir outras" : "Sugerir receitas saudáveis"}</button>
          {error && <span className="small" style={{ color: "var(--danger)" }}>{error}</span>}
          {recipes.length > 0 && <button className="btn ghost" onClick={() => { setChanging(false); setOptions(null); }}>Manter as receitas atuais</button>}
        </div>
      )}

      {showPicker && options && (
        <>
          <div className="section-title">Escolha as receitas</div>
          <div className="stack">
            {options.map((r, i) => (
              <div key={i} className="card task-card">
                <div className="head">
                  <input type="checkbox" checked={picked.has(i)} aria-label={`Usar ${r.title}`}
                    onChange={() => setPicked((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })} />
                  <div style={{ flex: 1 }}>
                    <b>{r.title}</b>
                    <div className="row wrap" style={{ marginTop: 6 }}>
                      <span className="chip">{fmtDur(r.prep_min)} no total</span>
                      <span className="chip">{fmtDur(r.active_min)} ativo</span>
                      <span className="chip">{r.servings} porções</span>
                    </div>
                    {r.health_notes && <div className="small muted" style={{ marginTop: 6 }}>{r.health_notes}</div>}
                    <RecipeDetails ingredients={r.ingredients} steps={r.steps} open={open === `o${i}`} onToggle={() => setOpen(open === `o${i}` ? null : `o${i}`)} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="sticky-actions">
            <button className="btn primary" disabled={busy || picked.size === 0} onClick={use}>
              Usar {picked.size} receita(s) e montar lista
            </button>
          </div>
        </>
      )}

      {!showPicker && (
        <>
          {planId && (
            <a className="banner warn" style={{ textDecoration: "none", marginBottom: 10 }} href={`#/proposta/${planId}`}>
              <span style={{ flex: 1 }}><b>O horário mudou</b><br /><span className="small">A duração nova pede outro encaixe: toque para aprovar.</span></span>
            </a>
          )}
          <div className="banner" style={{ marginTop: 4 }}>
            <span style={{ flex: 1 }}>
              <b>{step.title}</b>: {fmtDur(step.durationMin)}
              <br /><span className="small muted">Tempo calculado pelas receitas: trabalho ativo somado, esperas em paralelo.</span>
            </span>
          </div>

          <div className="section-title row"><span className="spacer">Lista de compras · {pending} pendente(s)</span>
            <button className="btn ghost" onClick={() => copyList(items)}>Copiar</button></div>
          <div className="card">
            {[...bySection.entries()].map(([sec, list]) => (
              <div key={sec} style={{ marginBottom: 10 }}>
                <div className="small muted" style={{ fontWeight: 600, margin: "4px 0" }}>{SECTION_LABEL[sec as Section] ?? sec}</div>
                {list.map((it) => (
                  <label key={it.id} className="row" style={{ padding: "6px 0", opacity: it.checked ? 0.5 : 1 }}>
                    <input type="checkbox" checked={it.checked} style={{ width: 20, height: 20, accentColor: "var(--accent)" }}
                      onChange={(e) => db.shoppingItems.update(it.id, { checked: e.target.checked })} />
                    <span style={{ flex: 1, textDecoration: it.checked ? "line-through" : "none" }}>{it.name}</span>
                    <span className="small muted">{fmtQty(it.qty, it.unit)}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>

          <div className="section-title row"><span className="spacer">Receitas</span>
            <button className="btn ghost" onClick={() => setChanging(true)}>Trocar</button></div>
          <div className="stack">
            {recipes.map((r) => (
              <div key={r.id} className="card">
                <b>{r.title}</b>
                <div className="row wrap" style={{ marginTop: 6 }}>
                  <span className="chip">{fmtDur(r.prepMin)} no total</span>
                  <span className="chip">{r.servings} porções</span>
                </div>
                <RecipeDetails ingredients={r.ingredients} steps={r.steps} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RecipeDetails({ ingredients, steps, open, onToggle }: { ingredients: { name: string; qty: number | null; unit: string | null }[]; steps: string[]; open: boolean; onToggle: () => void }) {
  return (
    <>
      <button className="btn ghost small" style={{ minHeight: 32, padding: "2px 0", marginTop: 4 }} onClick={onToggle}>{open ? "Esconder" : "Ver ingredientes e preparo"}</button>
      {open && (
        <div className="small" style={{ marginTop: 4 }}>
          <ul style={{ margin: "4px 0 8px", paddingLeft: 18 }}>
            {ingredients.map((i, k) => <li key={k}>{i.name} — {fmtQty(i.qty, i.unit)}</li>)}
          </ul>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {steps.map((s, k) => <li key={k} style={{ marginBottom: 4 }}>{s}</li>)}
          </ol>
        </div>
      )}
    </>
  );
}

async function copyList(items: { name: string; qty: number | null; unit: string | null; checked: boolean }[]) {
  const text = items.filter((i) => !i.checked).map((i) => `- ${i.name}: ${fmtQty(i.qty, i.unit)}`).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    toast("Lista copiada.");
  } catch {
    toast("Não consegui copiar.");
  }
}

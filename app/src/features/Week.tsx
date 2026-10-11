import { useLiveQuery } from "dexie-react-hooks";
import { dayTimeline } from "@shared/scheduler/index.ts";
import { db } from "../data/db";
import { baseInput } from "../data/planner";
import type { Block } from "../data/types";
import { addDaysLocal, fmtDayLabel, fmtDayShort, fmtDur, fmtRange, localDate, todayLocal } from "../lib/format";
import { navigate } from "../lib/router";

const VISIBLE: Block["status"][] = ["proposto", "confirmado", "em_andamento", "concluido"];
const minutes = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));

/** Soma de intervalos sem contar duas vezes os que se sobrepõem (fim do dia fora/casa). */
function unionMinutes(segs: { start: string; end: string }[]): number {
  const iv = segs.map((s) => [Date.parse(s.start), Date.parse(s.end)]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: number[] | null = null;
  for (const [a, b] of iv) {
    if (!cur || a > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [a, b];
    } else cur[1] = Math.max(cur[1], b);
  }
  if (cur) total += cur[1] - cur[0];
  return Math.round(total / 60000);
}

export function Week() {
  const data = useLiveQuery(async () => {
    const input = await baseInput();
    const today = todayLocal();
    const blocks = await db.blocks.where("status").anyOf(VISIBLE).toArray();
    const tasks = new Map((await db.tasks.toArray()).map((t) => [t.id, t]));
    const events = await db.events.toArray();
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDaysLocal(today, i);
      const dayBlocks = blocks.filter((b) => localDate(b.start) === date).sort((a, b) => a.start.localeCompare(b.start));
      const segs = dayTimeline(date, input, dayBlocks.filter((b) => b.status !== "proposto"));
      const commits = segs.filter((s) => s.kind === "compromisso");
      const free = unionMinutes(segs.filter((s) => s.kind === "janela"));
      const allDay = events.filter((e) => e.allDay && localDate(e.start) === date);
      const used = dayBlocks.reduce((a, b) => a + minutes(b.start, b.end), 0);
      return { date, commits, dayBlocks, tasks, free, used, allDay };
    });
  }, []);

  return (
    <>
      <header className="top"><h1>Semana</h1></header>
      <div className="week">
        {data?.map((d) => {
          const items = [
            ...d.commits.map((c) => ({ start: c.start, el: (
              <div key={`c${c.start}`} className="week-item commit"><span className="t">{fmtRange(c.start, c.end)}</span><span>{c.title}</span></div>
            ) })),
            ...d.dayBlocks.map((b) => {
              const t = d.tasks.get(b.taskId);
              return { start: b.start, el: (
                <button key={b.id} className={`week-item cat-${t?.category ?? "pessoal"}`} style={{ opacity: b.status === "concluido" ? 0.5 : 1, borderStyle: b.status === "proposto" ? "dashed" : "solid" }}
                  onClick={() => navigate(b.status === "proposto" && b.planId ? `proposta/${b.planId}` : `checkin/${b.id}`)}>
                  <span className="t">{fmtRange(b.start, b.end)}</span><span className="dot" /><span style={{ flex: 1 }}>{t?.title ?? "Tarefa"}</span>
                </button>
              ) };
            }),
          ].sort((a, b) => a.start.localeCompare(b.start));
          const pct = d.free ? Math.round((d.used / d.free) * 100) : 0;
          return (
            <section key={d.date} className="week-day">
              <h3>{fmtDayLabel(d.date)}{fmtDayLabel(d.date).length < 8 && <span className="muted">{fmtDayShort(d.date)}</span>}</h3>
              <div className="small muted">{fmtDur(Math.max(0, d.free - d.used))} livres</div>
              <div className="load" aria-hidden><div style={{ width: `${Math.min(100, pct)}%` }} /></div>
              {d.allDay.length > 0 && <div className="row wrap" style={{ marginBottom: 6 }}>{d.allDay.map((e) => <span key={e.id} className="chip warn">{e.title}</span>)}</div>}
              <div className="stack" style={{ gap: 6 }}>
                {items.length ? items.map((x) => x.el) : <div className="muted small">Nada marcado</div>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

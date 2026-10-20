import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { dayTimeline, type TimelineSegment } from "@shared/scheduler/index.ts";
import { db } from "../data/db";
import { baseInput, pendingCheckins } from "../data/planner";
import type { Block, Task } from "../data/types";
import { IconBack, IconNext } from "../components/Icons";
import { addDaysLocal, fmtDayLabel, fmtDur, fmtRange, fmtTime, localDate, todayLocal } from "../lib/format";
import { navigate } from "../lib/router";
import { isNative } from "../lib/native";
import { androidNeedsSetup } from "./AndroidSetup";

type Row =
  | { kind: "seg"; seg: TimelineSegment }
  | { kind: "free"; start: string; end: string; label: string }
  | { kind: "block"; block: Block; task?: Task; parent?: Task };

const VISIBLE: Block["status"][] = ["proposto", "confirmado", "em_andamento", "concluido"];

export function useDay(date: string) {
  return useLiveQuery(async () => {
    const input = await baseInput();
    const blocks = (await db.blocks.where("status").anyOf(VISIBLE).toArray()).filter((b) => localDate(b.start) === date);
    const tasks = new Map((await db.tasks.toArray()).map((t) => [t.id, t]));
    const segs = dayTimeline(date, input, blocks.filter((b) => b.status !== "proposto"));
    const allDay = (await db.events.toArray()).filter((e) => e.allDay && localDate(e.start) === date);
    return { segs, blocks, tasks, allDay };
  }, [date]);
}

export function buildRows(data: NonNullable<ReturnType<typeof useDay>>): Row[] {
  const rows: Row[] = [];
  const blocks = data.blocks.slice().sort((a, b) => a.start.localeCompare(b.start));
  for (const seg of data.segs) {
    if (seg.kind !== "janela") {
      rows.push({ kind: "seg", seg });
      continue;
    }
    // janela livre menos o que já tem tarefa
    let cursor = Date.parse(seg.start);
    const end = Date.parse(seg.end);
    for (const b of blocks) {
      const bs = Date.parse(b.start);
      const be = Date.parse(b.end);
      if (be <= cursor || bs >= end) continue;
      if (bs - cursor >= 15 * 60000) rows.push({ kind: "free", start: new Date(cursor).toISOString(), end: b.start, label: seg.title });
      cursor = Math.max(cursor, be);
    }
    if (end - cursor >= 15 * 60000) rows.push({ kind: "free", start: new Date(cursor).toISOString(), end: seg.end, label: seg.title });
  }
  for (const b of blocks) {
    const task = data.tasks.get(b.taskId);
    rows.push({ kind: "block", block: b, task, parent: task?.parentId ? data.tasks.get(task.parentId) : undefined });
  }
  const startOf = (r: Row) => (r.kind === "seg" ? r.seg.start : r.kind === "free" ? r.start : r.block.start);
  return rows.sort((a, b) => Date.parse(startOf(a)) - Date.parse(startOf(b)) || (a.kind === "block" ? -1 : 1));
}

export function Today() {
  const [date, setDate] = useState(todayLocal);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const data = useDay(date);
  const proposals = useLiveQuery(() => db.plans.where("status").equals("proposta").toArray(), []);
  const pending = useLiveQuery(() => pendingCheckins(now), [now]);
  const tasks = useLiveQuery(async () => new Map((await db.tasks.toArray()).map((t) => [t.id, t])), []);
  const isToday = date === todayLocal();
  const [needsAndroid, setNeedsAndroid] = useState(false);
  useEffect(() => {
    if (isNative()) androidNeedsSetup().then(setNeedsAndroid);
  }, []);

  const rows = data ? buildRows(data) : [];
  const nowIdx = isToday ? rows.findIndex((r) => Date.parse(r.kind === "seg" ? r.seg.end : r.kind === "free" ? r.end : r.block.end) > now) : -1;

  return (
    <>
      <header className="top">
        <h1>{fmtDayLabel(date, true)}</h1>
        {!isToday && <button className="btn ghost" onClick={() => setDate(todayLocal())}>Hoje</button>}
      </header>

      <div className="stack">
        {needsAndroid && (
          <button className="banner warn" style={{ border: 0, textAlign: "left" }} onClick={() => navigate("android")}>
            <span style={{ flex: 1 }}><b>Libere os avisos no Android</b><br /><span className="small">Notificações, alarmes exatos e bateria: 1 minuto.</span></span>
            <IconNext />
          </button>
        )}
        {proposals?.map((p) => (
          <button key={p.id} className="banner" style={{ border: 0, textAlign: "left" }} onClick={() => navigate(`proposta/${p.id}`)}>
            <span style={{ flex: 1 }}><b>Proposta aguardando aprovação</b><br /><span className="small muted">{p.trigger === "checkin" ? "Reorganização após check-in" : `${p.taskIds.length} tarefa(s)`}</span></span>
            <IconNext />
          </button>
        ))}
        {pending && pending.length > 0 && (
          <div className="banner warn">
            <span style={{ flex: 1 }}>
              <b>Como foi?</b>
              {pending.slice(0, 3).map((b) => (
                <a key={b.id} href={`#/checkin/${b.id}`} style={{ display: "block", color: "inherit" }}>
                  {tasks?.get(b.taskId)?.title ?? "Tarefa"} · terminou {fmtTime(b.end)}
                </a>
              ))}
            </span>
          </div>
        )}
      </div>

      {data && data.allDay.length > 0 && (
        <div className="row wrap" style={{ marginTop: 12 }}>
          {data.allDay.map((e) => <span key={e.id} className="chip warn" style={{ fontSize: "0.85rem", padding: "5px 12px" }}>📌 {e.title}</span>)}
        </div>
      )}

      <div className="day-nav" style={{ marginTop: 12 }}>
        <button className="icon-btn" aria-label="Dia anterior" onClick={() => setDate(addDaysLocal(date, -1))}><IconBack /></button>
        <div className="label muted small">{date.split("-").reverse().join("/")}</div>
        <button className="icon-btn" aria-label="Próximo dia" onClick={() => setDate(addDaysLocal(date, 1))}><IconNext /></button>
      </div>

      {!data ? null : rows.length === 0 ? (
        <div className="empty"><div className="big">🗓️</div>Dia livre.</div>
      ) : (
        <div className="timeline">
          {rows.map((r, i) => (
            <div key={i}>
              {i === nowIdx && <div className="tl-now" aria-label="Agora" />}
              <RowView r={r} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function RowView({ r }: { r: Row }) {
  if (r.kind === "seg") {
    const s = r.seg;
    return (
      <div className="tl-row">
        <div className="tl-time">{fmtTime(s.start)}</div>
        <div className={`tl-item ${s.kind === "compromisso" ? "commit" : "travel"}`}>
          {s.kind === "compromisso" ? (
            <><div className="title">{s.title}</div><div className="meta"><span>{fmtRange(s.start, s.end)}</span>{s.region && <span>{s.region}</span>}</div></>
          ) : (
            <>🚗 {s.title} · {fmtDur(Math.round((Date.parse(s.end) - Date.parse(s.start)) / 60000))}</>
          )}
        </div>
      </div>
    );
  }
  if (r.kind === "free") {
    return (
      <div className="tl-row">
        <div className="tl-time">{fmtTime(r.start)}</div>
        <div className="tl-item free">{r.label} · {fmtDur(Math.round((Date.parse(r.end) - Date.parse(r.start)) / 60000))}</div>
      </div>
    );
  }
  const b = r.block;
  const t = r.task;
  const proposed = b.status === "proposto";
  return (
    <div className="tl-row">
      <div className="tl-time">{fmtTime(b.start)}</div>
      <button
        className={`tl-item task cat-${t?.category ?? "pessoal"} ${proposed ? "proposed" : ""} ${b.status === "concluido" ? "done" : ""}`}
        onClick={() => navigate(proposed && b.planId ? `proposta/${b.planId}` : `checkin/${b.id}`)}
      >
        <div className="title">{t?.title ?? "Tarefa"}</div>
        <div className="meta">
          <span>{fmtRange(b.start, b.end)}</span>
          {r.parent && <span>{r.parent.title}</span>}
          {b.windowKind === "fora" && b.region && <span>em {b.region}</span>}
          {proposed && <span className="chip accent">proposta</span>}
          {b.status === "em_andamento" && <span className="chip warn">estendida</span>}
        </div>
      </button>
    </div>
  );
}

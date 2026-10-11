// Onboarding → lugares, deslocamentos e compromissos fixos.
import { db } from "./db";
import { normalizeSettings } from "./defaults";
import type { Commitment, Place, RoutineDraft, Settings, TimeRange, Travel, WakeSleep } from "./types";

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const placeId = (kind: string) => `place-${kind}`;

export async function getSettings(): Promise<Settings> {
  return normalizeSettings(await db.settings.get("me"));
}

/** Horários efetivos de um dia da semana, respeitando "mesmo horário todos os dias". */
export const sleepFor = (r: RoutineDraft, wd: number): WakeSleep =>
  r.sleep.sameTime ? { wake: r.sleep.wake, sleep: r.sleep.sleep } : r.sleep.days[wd] ?? { wake: null, sleep: null };
export const internshipFor = (r: RoutineDraft, wd: number): TimeRange =>
  r.internship.sameTime ? { start: r.internship.start, end: r.internship.end } : r.internship.times[wd] ?? r.internship;
export const collegeFor = (r: RoutineDraft, wd: number): TimeRange =>
  r.college.sameTime ? { start: r.college.start, end: r.college.end } : r.college.times[wd] ?? r.college;

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const cur = await getSettings();
  await db.settings.put({ ...cur, ...patch, id: "me" });
}

export async function applyRoutine(draft: RoutineDraft, patch: Partial<Settings>): Promise<void> {
  const places: Place[] = (Object.keys(draft.places) as (keyof RoutineDraft["places"])[]).map((kind) => ({
    id: placeId(kind),
    kind,
    name: draft.places[kind].name.trim() || kind,
    region: draft.places[kind].region.trim() || null,
  }));

  const travel: Travel[] = Object.entries(draft.travel)
    .filter(([, m]) => Number.isFinite(m) && m >= 0)
    .map(([k, minutes]) => {
      const [from, to] = k.split(">");
      return { id: `travel-${from}-${to}`, fromPlaceId: placeId(from), toPlaceId: placeId(to), minutes };
    });

  const commitments: Commitment[] = [];
  if (draft.internship.enabled) {
    for (let wd = 0; wd < 7; wd++) {
      const where = draft.internship.days[wd];
      if (!where) continue;
      const t = internshipFor(draft, wd);
      if (t.end <= t.start) continue;
      commitments.push({
        id: `est-${wd}`,
        title: where === "casa" ? "Estágio (home office)" : where === "terminal" ? "Estágio (terminal)" : "Estágio",
        category: "trabalho",
        weekday: wd,
        start: t.start,
        end: t.end,
        placeId: placeId(where),
        active: true,
        origin: "onboarding",
      });
    }
  }
  if (draft.college.enabled) {
    for (const wd of draft.college.days) {
      const t = collegeFor(draft, wd);
      if (t.end <= t.start) continue;
      commitments.push({
        id: `facu-${wd}`,
        title: "Faculdade",
        category: "faculdade",
        weekday: wd,
        start: t.start,
        end: t.end,
        placeId: placeId("faculdade"),
        active: true,
        origin: "onboarding",
      });
    }
  }

  const days = draft.internship.days;
  const homeOffice = Object.keys(days).map(Number).find((d) => days[d] === "casa") ?? null;
  const terminal = Object.keys(days).map(Number).find((d) => days[d] === "terminal") ?? null;

  await db.transaction("rw", [db.places, db.travel, db.commitments, db.settings], async () => {
    await db.places.clear();
    await db.places.bulkPut(places);
    await db.travel.clear();
    await db.travel.bulkPut(travel);
    await db.commitments.where("id").startsWithAnyOf("est-", "facu-").delete();
    await db.commitments.bulkPut(commitments);
    const cur = await getSettings();
    await db.settings.put({
      ...cur,
      ...patch,
      routine: draft,
      homeOfficeWeekday: homeOffice,
      terminalWeekday: terminal,
      onboardingDone: true,
      id: "me",
    });
  });
}

const sleepText = (t: WakeSleep) =>
  `acorda ${t.wake ?? "sem horário fixo"}, dorme ${t.sleep ?? "sem horário fixo"}`;

/** Resumo em texto da rotina, enviado como contexto para a IA. */
export function routineSummary(s: Settings): string {
  const r = s.routine;
  const lines: string[] = [];
  if (r.sleep.sameTime) lines.push(`Todos os dias: ${sleepText(r.sleep)}.`);
  else for (const wd of [1, 2, 3, 4, 5, 6, 0]) lines.push(`${WEEKDAYS[wd]}: ${sleepText(sleepFor(r, wd))}.`);
  const label = { trabalho: r.places.trabalho, terminal: r.places.terminal, casa: r.places.casa } as const;
  if (r.internship.enabled) {
    for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
      const w = r.internship.days[wd];
      if (!w) continue;
      const p = label[w];
      const t = internshipFor(r, wd);
      lines.push(`${WEEKDAYS[wd]}: estágio ${t.start}–${t.end} ${w === "casa" ? "em casa (home office)" : `no ${p.name.toLowerCase()} (${p.region})`}.`);
    }
  }
  if (r.college.enabled) {
    for (const wd of r.college.days) {
      const t = collegeFor(r, wd);
      lines.push(`${WEEKDAYS[wd]}: faculdade ${t.start}–${t.end} (${r.places.faculdade.region}).`);
    }
  }
  lines.push(
    `Casa em ${r.places.casa.region}.` +
      (s.returnHomeInGaps ? "" : ` Entre o estágio e a faculdade fica em ${r.places.trabalho.region}, não volta para casa.`),
  );
  return lines.join("\n");
}

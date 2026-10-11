// Onboarding → lugares, deslocamentos e compromissos fixos.
import { db } from "./db";
import { DEFAULT_SETTINGS } from "./defaults";
import type { Commitment, Place, RoutineDraft, Settings, Travel } from "./types";

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const placeId = (kind: string) => `place-${kind}`;

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get("me");
  return s ? { ...DEFAULT_SETTINGS, ...s } : DEFAULT_SETTINGS;
}

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
      commitments.push({
        id: `est-${wd}`,
        title: where === "casa" ? "Estágio (home office)" : where === "terminal" ? "Estágio (terminal)" : "Estágio",
        category: "trabalho",
        weekday: wd,
        start: draft.internship.start,
        end: draft.internship.end,
        placeId: placeId(where),
        active: true,
        origin: "onboarding",
      });
    }
  }
  if (draft.college.enabled) {
    for (const wd of draft.college.days) {
      commitments.push({
        id: `facu-${wd}`,
        title: "Faculdade",
        category: "faculdade",
        weekday: wd,
        start: draft.college.start,
        end: draft.college.end,
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

/** Resumo em texto da rotina, enviado como contexto para a IA. */
export function routineSummary(s: Settings): string {
  const r = s.routine;
  const lines: string[] = [`Acorda ${s.wakeTime}, dorme ${s.sleepTime}.`];
  const label = { trabalho: r.places.trabalho, terminal: r.places.terminal, casa: r.places.casa } as const;
  if (r.internship.enabled) {
    for (let wd = 1; wd <= 6; wd++) {
      const w = r.internship.days[wd];
      if (!w) continue;
      const p = label[w];
      lines.push(`${WEEKDAYS[wd]}: estágio ${r.internship.start}–${r.internship.end} ${w === "casa" ? "em casa (home office)" : `no ${p.name.toLowerCase()} (${p.region})`}.`);
    }
  }
  if (r.college.enabled && r.college.days.length) {
    lines.push(`Faculdade ${r.college.start}–${r.college.end} (${r.places.faculdade.region}) às ${r.college.days.map((d) => WEEKDAYS[d].toLowerCase()).join(", ")}.`);
  }
  lines.push(
    `Casa em ${r.places.casa.region}.` +
      (s.returnHomeInGaps ? "" : ` Entre o estágio e a faculdade fica em ${r.places.trabalho.region}, não volta para casa.`),
  );
  return lines.join("\n");
}

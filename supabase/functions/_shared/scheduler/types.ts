// Tipos de entrada e saída do agendador. Sem dependências: o mesmo código roda
// no app (Vite) e nas Edge Functions (Deno).

export type LocationReq = "casa" | "rua" | "qualquer";
export type WindowKind = "casa" | "fora";
export type PlaceKind = "casa" | "trabalho" | "terminal" | "faculdade" | "outro";

export interface Place {
  id: string;
  kind: PlaceKind;
  name: string;
  region: string | null;
}

export interface TravelTime {
  fromPlaceId: string;
  toPlaceId: string;
  minutes: number;
}

/** Compromisso fixo semanal (estágio, faculdade…). Horários "HH:MM". */
export interface FixedCommitment {
  id: string;
  title: string;
  weekday: number;
  start: string;
  end: string;
  placeId: string | null;
  active?: boolean;
  validFrom?: string | null;
  validUntil?: string | null;
}

/** Compromisso pontual (Google Calendar ou capturado). Instantes em ISO. */
export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  blocksTime?: boolean;
  placeId?: string | null;
}

/** Horário de acordar/dormir de um dia. null = sem horário fixo. */
export interface DayTimes {
  wake: string | null;
  sleep: string | null;
}

export interface SchedulerSettings {
  timezone: string;
  /** Referência para os dias (ou campos) sem horário fixo. */
  wakeTime: string;
  sleepTime: string;
  /** Horários por dia da semana (0–6). Dia ausente ou campo null → wakeTime/sleepTime. */
  dayTimes?: Partial<Record<number, DayTimes>>;
  /** Início do silêncio; null = segue o horário de dormir de cada dia. */
  quietStart: string | null;
  quietEnd: string | null;
  slotGranularityMin: number;
  taskBufferMin: number;
  returnHomeInGaps: boolean;
  goHomeMinStayMin: number;
  errandFromHomeOverheadMin: number;
  lateHour: string;
}

export interface TaskInput {
  id: string;
  parentId?: string | null;
  seq?: number;
  title: string;
  durationMin: number;
  earliestStart?: string | null;
  deadline?: string | null;
  deadlineHard?: boolean;
  priority: number;
  location: LocationReq;
  region?: string | null;
  splittable?: boolean;
  minChunkMin?: number | null;
}

/** Bloco que já ocupa a agenda e não deve ser movido. */
export interface BusyBlock {
  id: string;
  taskId: string;
  start: string;
  end: string;
  windowKind?: WindowKind | null;
}

export interface ScheduleInput {
  now: string;
  horizonDays: number;
  settings: SchedulerSettings;
  places: Place[];
  travel: TravelTime[];
  commitments: FixedCommitment[];
  events: CalendarEvent[];
  tasks: TaskInput[];
  busy: BusyBlock[];
}

export interface PlannedBlock {
  taskId: string;
  start: string;
  end: string;
  windowKind: WindowKind;
  region: string | null;
}

export interface Unplaced {
  taskId: string;
  reason: string;
}

export interface ScheduleResult {
  blocks: PlannedBlock[];
  unplaced: Unplaced[];
}

export type SegmentKind = "compromisso" | "deslocamento" | "janela";

export interface TimelineSegment {
  kind: SegmentKind;
  start: string;
  end: string;
  title: string;
  placeId: string | null;
  windowKind?: WindowKind;
  region?: string | null;
  sourceId?: string;
}

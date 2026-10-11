// Entidades locais (IndexedDB). Espelham as tabelas do Postgres em camelCase;
// na Fase 2 o sync converte de um para o outro.
import type { Category } from "@shared/interpret/contract.ts";
import type { LocationReq, PlaceKind, WindowKind } from "@shared/scheduler/index.ts";

export type { Category, LocationReq, PlaceKind, WindowKind };
export type AlertMode = "nenhum" | "lembrete" | "alarme";
export type ScheduleMode = "direto" | "proposta";

export interface Settings {
  id: "me";
  onboardingDone: boolean;
  timezone: string;
  wakeTime: string;
  sleepTime: string;
  homeOfficeWeekday: number | null;
  terminalWeekday: number | null;
  scheduleMode: ScheduleMode;
  defaultAlertMode: AlertMode;
  // notificações (usadas a partir das Fases 2/3)
  quietStart: string;
  quietEnd: string | null;
  silentMode: boolean;
  notifyStart: boolean;
  notifyEnd: boolean;
  notifyProposal: boolean;
  reminderLeadMin: number;
  moreTimeDefaultMin: number;
  // agendador
  slotGranularityMin: number;
  taskBufferMin: number;
  returnHomeInGaps: boolean;
  goHomeMinStayMin: number;
  errandFromHomeOverheadMin: number;
  lateHour: string;
  horizonDays: number;
  routine: RoutineDraft;
}

/** O que o onboarding coleta; gera lugares, deslocamentos e compromissos. */
export interface RoutineDraft {
  places: Record<Exclude<PlaceKind, "outro">, { name: string; region: string }>;
  internship: {
    enabled: boolean;
    start: string;
    end: string;
    /** por dia da semana (0–6): onde é o estágio, ou null = não tem */
    days: Record<number, "trabalho" | "terminal" | "casa" | null>;
  };
  college: { enabled: boolean; start: string; end: string; days: number[] };
  travel: Record<string, number>; // "casa>trabalho": 60
}

export interface Place {
  id: string;
  kind: PlaceKind;
  name: string;
  region: string | null;
}

export interface Travel {
  id: string;
  fromPlaceId: string;
  toPlaceId: string;
  minutes: number;
}

export interface Commitment {
  id: string;
  title: string;
  category: Category;
  weekday: number;
  start: string;
  end: string;
  placeId: string | null;
  active: boolean;
  origin: "onboarding" | "manual";
}

export interface AgendaEvent {
  id: string;
  source: "gcal" | "captura" | "manual";
  title: string;
  category: Category | null;
  start: string;
  end: string;
  allDay: boolean;
  blocksTime: boolean;
  placeId: string | null;
  locationText: string | null;
  captureId: string | null;
  createdAt: string;
}

export type CaptureStatus = "pendente" | "interpretando" | "interpretado" | "erro" | "arquivado";

export interface Capture {
  id: string;
  rawText: string;
  input: "texto" | "voz";
  status: CaptureStatus;
  llmResult: unknown | null;
  llmModel: string | null;
  error: string | null;
  createdAt: string;
}

export type TaskStatus = "inbox" | "pendente" | "agendada" | "em_andamento" | "concluida" | "cancelada";

export interface Task {
  id: string;
  parentId: string | null;
  seq: number;
  captureId: string | null;
  title: string;
  notes: string | null;
  category: Category;
  durationMin: number;
  actualMin: number | null;
  earliestStart: string | null;
  deadline: string | null;
  deadlineHard: boolean;
  priority: number;
  location: LocationReq;
  region: string | null;
  alertMode: AlertMode | null;
  splittable: boolean;
  minChunkMin: number | null;
  isCooking: boolean;
  inferred: boolean;
  status: TaskStatus;
  unplacedReason: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PlanTrigger = "captura" | "checkin" | "manual" | "rotina" | "gcal";

export interface Plan {
  id: string;
  trigger: PlanTrigger;
  status: "proposta" | "aprovada" | "descartada";
  taskIds: string[];
  excludedTaskIds: string[];
  eventIds: string[];
  captureId: string | null;
  unplaced: { taskId: string; reason: string }[];
  createdAt: string;
  decidedAt: string | null;
}

export type BlockStatus = "proposto" | "confirmado" | "em_andamento" | "concluido" | "remarcado" | "cancelado";

export interface Block {
  id: string;
  taskId: string;
  planId: string | null;
  start: string;
  end: string;
  windowKind: WindowKind | null;
  region: string | null;
  status: BlockStatus;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Checkin {
  id: string;
  blockId: string;
  moment: "inicio" | "fim";
  response: "terminei" | "mais_tempo" | "remarcar" | "ignorado";
  extraMin: number | null;
  channel: "android" | "web_push" | "tela";
  createdAt: string;
}

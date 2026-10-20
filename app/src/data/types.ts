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
  /** Referência para dias "sem horário fixo" de acordar/dormir. */
  wakeTime: string;
  sleepTime: string;
  homeOfficeWeekday: number | null;
  terminalWeekday: number | null;
  scheduleMode: ScheduleMode;
  defaultAlertMode: AlertMode;
  // notificações (usadas a partir das Fases 2/3)
  /** null = silêncio segue o horário de dormir/acordar de cada dia. */
  quietStart: string | null;
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
  /** eventos do "Agenda IA" com lembrete do próprio Google (padrão: sem) */
  gcalReminders: boolean;
  /** calendários lidos como compromissos (vazio = principal) */
  gcalReadCalendarIds: string[];
  routine: RoutineDraft;
}

export interface TimeRange {
  start: string;
  end: string;
}

/** Acordar/dormir de um dia. null = sem horário fixo. */
export interface WakeSleep {
  wake: string | null;
  sleep: string | null;
}

/**
 * O que o onboarding coleta; gera lugares, deslocamentos e compromissos.
 * Cada horário tem "mesmo horário todos os dias" (sameTime) ou um por dia.
 */
export interface RoutineDraft {
  places: Record<Exclude<PlaceKind, "outro">, { name: string; region: string }>;
  sleep: WakeSleep & { sameTime: boolean; days: Record<number, WakeSleep> };
  internship: TimeRange & {
    enabled: boolean;
    sameTime: boolean;
    /** por dia da semana (0–6): onde é o estágio, ou null = não tem */
    days: Record<number, "trabalho" | "terminal" | "casa" | null>;
    times: Record<number, TimeRange>;
  };
  college: TimeRange & { enabled: boolean; sameTime: boolean; days: number[]; times: Record<number, TimeRange> };
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
  routineId?: string | null;
  /** dia (YYYY-MM-DD) da ocorrência da rotina que gerou a tarefa */
  routineDate?: string | null;
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

// ---------------------------------------------------------------------------
// Fase 4: rotinas e modo cozinha
// ---------------------------------------------------------------------------

export interface RoutineStep {
  title: string;
  durationMin: number;
  location: LocationReq;
  region: string | null;
}

/** Modelo da tarefa criada a cada ocorrência da rotina. */
export interface RoutineTemplate {
  title: string;
  category: Category;
  durationMin: number;
  location: LocationReq;
  region: string | null;
  priority: number;
  isCooking: boolean;
  splittable: boolean;
  alertMode: AlertMode | null;
  notes: string | null;
  subtasks: RoutineStep[];
}

export interface Routine {
  id: string;
  title: string;
  /** RFC 5545 simplificado: FREQ=WEEKLY;BYDAY=WE[,FR][;INTERVAL=2] */
  rrule: string;
  template: RoutineTemplate;
  /** janela preferida no dia (opcional) */
  preferredStart: string | null;
  preferredEnd: string | null;
  /** primeira data válida (base para INTERVAL) */
  startDate: string;
  active: boolean;
  generatedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeIngredient {
  name: string;
  qty: number | null;
  unit: string | null;
  section: string;
}

export interface Recipe {
  id: string;
  taskId: string | null;
  title: string;
  servings: number;
  prepMin: number;
  activeMin: number;
  ingredients: RecipeIngredient[];
  steps: string[];
  healthNotes: string | null;
  chosen: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ShoppingList {
  id: string;
  taskId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShoppingItem {
  id: string;
  listId: string;
  name: string;
  qty: number | null;
  unit: string | null;
  section: string;
  recipeIds: string[];
  checked: boolean;
  updatedAt: string;
}

/** Estado interno (sync, sementes etc.). */
export interface KV {
  key: string;
  value: unknown;
}

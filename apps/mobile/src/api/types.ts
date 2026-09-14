/**
 * Contrato con el servidor.
 *
 * Espejo de `services/api/app/api/dto.py`. Los nombres van en camelCase porque
 * es lo que el servidor emite: los modelos de Pydantic llevan un
 * `alias_generator`, así que no hay capa de traducción en ninguno de los dos
 * lados.
 *
 * Si cambias algo aquí, cambia también el DTO de Python. No hay nada que lo
 * compruebe automáticamente todavía —eso sería un generador de tipos desde el
 * OpenAPI, y está fuera del alcance de la Fase 3.
 */

import type {
  Aggressiveness,
  Feedback,
  MuscleGroup,
} from '@cage/engine';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  /** ISO 8601. Caducidad del access token. */
  expiresAt: string;
}

export type Role = 'admin' | 'coach' | 'athlete';

export interface UserOut {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  /** True mientras arrastre la contraseña provisional que le dio el admin. */
  mustChangePassword: boolean;
  /** Último día pagado (ISO). null para coach y admin, que no caducan. */
  accessEndsOn: string | null;
  /** Días que quedan, incluido hoy. null si el rol no caduca. */
  daysLeft: number | null;
  /** True cuando toca enseñarle el aviso de renovación. */
  renewalWarning: boolean;
}

export interface ExerciseCatalogOut {
  id: string;
  name: string;
  muscle: MuscleGroup;
  equipment: string;
  repLo: number;
  repHi: number;
  targetRir: number;
  loadIncrementKg: number;
}

export interface PrescriptionOut {
  mesocycleExerciseId: string;
  sets: number | null;
  loadKg: number | null;
  repLo: number | null;
  repHi: number | null;
  targetRir: number | null;
  restSeconds: number;
}

export interface MesocycleExerciseOut {
  id: string;
  position: number;
  name: string;
  muscle: string;
  equipment: string;
  repLo: number;
  repHi: number;
  targetRir: number;
  loadIncrementKg: number;
  prescription: PrescriptionOut | null;
}

export interface MesocycleOut {
  id: string;
  athleteId: string;
  coachId: string;
  name: string;
  totalWeeks: number;
  currentWeekIndex: number;
  aggressiveness: Aggressiveness;
  status: 'draft' | 'active' | 'completed' | 'archived';
  exercises: MesocycleExerciseOut[];
}

export interface PlannedSetOut {
  index: number;
  targetWeightKg: number;
  targetReps: number;
  why: string;
  loggedWeightKg: number | null;
  loggedReps: string | null;
  loggedRpe: string | null;
  done: boolean;
}

export interface SessionExerciseOut {
  id: string;
  position: number;
  name: string;
  muscle: string;
  plannedLoadKg: number;
  plannedSets: number;
  restSeconds: number;
  policyVersion: string;
  why: string;
  sets: PlannedSetOut[];
}

export interface SessionOut {
  id: string;
  mesocycleId: string;
  weekNumber: number;
  dayLabel: string;
  isDeload: boolean;
  startedAt: string | null;
  completedAt: string | null;
  exercises: SessionExerciseOut[];
}

/** Lo que sube el teléfono. `clientId` es la clave de idempotencia. */
export interface SetLogIn {
  clientId: string;
  sessionExerciseId: string;
  index: number;
  weightKg: number | null;
  reps: string | null;
  rpe: string | null;
  subSets: string | null;
  done: boolean;
  /** ISO 8601. Cuándo lo marcó el atleta, no cuándo llegó al servidor. */
  loggedAt: string | null;
}

export interface SyncResult {
  accepted: number;
  /** clientId que ya existían y se actualizaron en vez de duplicarse. */
  updated: string[];
}

export interface FeedbackIn {
  sessionExerciseId: string;
  feedback: Feedback;
}

// ── Panel del coach ─────────────────────────────────────────────────────────

export type AlertKind =
  | 'rir_al_limite'
  | 'dolor_articular'
  | 'e1rm_estancado'
  | 'adherencia_baja'
  | 'meso_terminando';

export interface AlertOut {
  kind: AlertKind;
  severity: 'info' | 'warning';
  subject: string;
  text: string;
  suggestion: string;
}

export type SessionStatus = 'Completa' | 'Parcial' | 'Perdida' | 'Pendiente';

export interface SessionSummaryOut {
  id: string;
  weekNumber: number;
  dayLabel: string;
  isDeload: boolean;
  completedAt: string | null;
  status: SessionStatus;
  setsDone: number;
  tonnageKg: number;
}

export interface AthleteSummaryOut {
  athlete: UserOut;
  mesocycleId: string | null;
  mesocycleName: string | null;
  currentWeek: number | null;
  totalWeeks: number | null;
  progress: number;
  adherence: number | null;
  alerts: AlertOut[];
  sessions: SessionSummaryOut[];
}

export interface AthleteCardOut {
  athlete: UserOut;
  mesocycleId: string | null;
  mesocycleName: string | null;
  currentWeek: number | null;
  totalWeeks: number | null;
  progress: number;
  adherence: number | null;
  alertCount: number;
  /** La alerta más urgente, para pintarla sin abrir la ficha. */
  topAlert: AlertOut | null;
}

export interface CoachOverviewOut {
  athletes: number;
  sessionsLast7Days: number;
  openAlerts: number;
}

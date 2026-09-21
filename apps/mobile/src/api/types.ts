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
  Exercise,
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

export interface PrescriptionIn {
  /** null = para todo el bloque. N = solo para esa semana. */
  weekNumber: number | null;
  sets: number | null;
  loadKg: number | null;
  /** Porcentaje del 1RM vigente. Mutuamente excluyente con `loadKg`. */
  loadPercent: number | null;
  repLo: number | null;
  repHi: number | null;
  targetRir: number | null;
  restSeconds: number;
}

export interface PrescriptionOut {
  mesocycleExerciseId: string;
  weekNumber: number | null;
  sets: number | null;
  loadKg: number | null;
  loadPercent: number | null;
  repLo: number | null;
  repHi: number | null;
  targetRir: number | null;
  restSeconds: number;
  /** La marca usada para resolver el porcentaje, o null si no aplica. */
  oneRmKg: number | null;
  /** True si hay `loadPercent` pero el atleta no tiene marca todavía. */
  needsOneRm: boolean;
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
  /**
   * Punto de partida de la semana 1. Con esto la app proyecta el mesociclo.
   * null cuando todavía no hay ningún peso: el accesorio se dejó libre.
   */
  startingLoadKg: number | null;
  startingReps: number;
  startingSets: number;
  prescription: PrescriptionOut | null;
}

export type TrainingGoal = 'fuerza' | 'hipertrofia' | 'hibrido';

export interface MesocycleSummaryOut {
  id: string;
  athleteId: string;
  athleteName: string;
  name: string;
  totalWeeks: number;
  currentWeekIndex: number;
  aggressiveness: Aggressiveness;
  goal: TrainingGoal;
  status: 'draft' | 'active' | 'completed' | 'archived';
  exerciseCount: number;
}

/** Una fila del paso 4 opcional: la carga de UNA semana de UN ejercicio. */
export interface WeekLoadIn {
  weekNumber: number;
  loadKg: number | null;
  loadPercent: number | null;
  sets: number | null;
  repLo: number | null;
  repHi: number | null;
  targetRir: number | null;
}

/** Lo que el coach manda al crear un mesociclo. */
export interface MesocycleExerciseIn {
  catalogId: string;
  repLo: number;
  repHi: number;
  targetRir: number;
  loadIncrementKg: number;
  /** null = sin arranque todavía; el atleta registra lo primero que levante. */
  startingLoadKg: number | null;
  startingReps: number;
  startingSets: number;
  /** Carga semana a semana. Para un BÁSICO, el servidor exige que cubra
   *  todas las semanas del bloque (kg o %). */
  weeks: WeekLoadIn[];
}

export interface MesocycleIn {
  athleteId: string;
  name: string;
  totalWeeks: number;
  aggressiveness: Aggressiveness;
  goal: TrainingGoal;
  exercises: MesocycleExerciseIn[];
}

export interface MesocycleOut {
  id: string;
  athleteId: string;
  coachId: string;
  name: string;
  totalWeeks: number;
  currentWeekIndex: number;
  aggressiveness: Aggressiveness;
  goal: TrainingGoal;
  status: 'draft' | 'active' | 'completed' | 'archived';
  exercises: MesocycleExerciseOut[];
}

export interface PlannedSetOut {
  index: number;
  /** null cuando el ejercicio no tiene ningún peso todavía: se registra el propio. */
  targetWeightKg: number | null;
  targetReps: number | null;
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
  /** null en la primera sesión de un ejercicio sin arranque todavía. */
  plannedLoadKg: number | null;
  plannedSets: number;
  restSeconds: number;
  policyVersion: string;
  why: string;
  sets: PlannedSetOut[];
  /**
   * El ejercicio tal como lo entiende el motor, con lo que hizo la vez
   * anterior.
   *
   * Viaja para que la app pueda enseñar el EFECTO del feedback antes de
   * enviarlo, al instante y sin cobertura. Lo que se persiste sale del
   * servidor igual que siempre.
   *
   * null junto con `plannedLoadKg` null: sin ningún peso previo no hay
   * preview local que calcular.
   */
  exercise: Exercise | null;
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


// ── La rejilla del plan ─────────────────────────────────────────────────────

/**
 * Lo que hará un ejercicio en una semana.
 *
 * Los `*Overridden` son lo que hace útil la pantalla: sin ellos el coach no
 * puede distinguir un número que puso él de uno que calculó el motor, y no
 * sabría qué está a punto de pisar.
 */
export interface PlanCellOut {
  weekNumber: number;
  isDeload: boolean;
  sets: number;
  /** null cuando no hay ningún peso que mostrar: la celda pinta —. */
  loadKg: number | null;
  /** El % que fijó el coach para esta semana, si lo hizo. */
  loadPercent: number | null;
  /** La marca usada para resolverlo, o null si no aplica. */
  oneRmKg: number | null;
  /** True si hace falta una marca de 1RM que todavía no existe. */
  needsOneRm: boolean;
  repLo: number;
  repHi: number;
  targetRir: number;
  restSeconds: number;
  setsOverridden: boolean;
  loadOverridden: boolean;
  repsOverridden: boolean;
  rirOverridden: boolean;
}

export interface PlanRowOut {
  mesocycleExerciseId: string;
  name: string;
  muscle: string;
  equipment: string;
  weeks: PlanCellOut[];
}

export interface PlanGridOut {
  mesocycleId: string;
  name: string;
  goal: TrainingGoal;
  totalWeeks: number;
  currentWeekIndex: number;
  rows: PlanRowOut[];
}

// ── Marcas de fuerza (1RM) ──────────────────────────────────────────────────

export type OneRepMaxSource = 'test' | 'competicion' | 'estimada';

export interface OneRepMaxIn {
  exerciseId: string;
  valueKg: number;
  /** ISO 8601. El día del TEST, no el de hoy. */
  achievedOn: string;
  source: OneRepMaxSource;
  note: string | null;
}

export interface OneRepMaxOut {
  id: string;
  exerciseId: string;
  exerciseName: string;
  muscle: string;
  valueKg: number;
  achievedOn: string;
  source: OneRepMaxSource;
  note: string | null;
  /** True si es la vigente de ese ejercicio: la más reciente por fecha. */
  current: boolean;
}

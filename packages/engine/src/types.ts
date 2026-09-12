/**
 * Tipos del dominio de The Cage 2.0.
 *
 * Regla invariante del sistema: TODA carga en este paquete está en KILOGRAMOS.
 * Las libras son una preferencia de presentación y se convierten en la capa de
 * render, nunca aquí ni en la persistencia. (Ver docs/engine-contract.md)
 */

/** Grupo muscular principal de un ejercicio. */
export const MuscleGroup = {
  Chest: 'CHEST',
  Back: 'BACK',
  Shoulders: 'SHOULDERS',
  Biceps: 'BICEPS',
  Triceps: 'TRICEPS',
  Quads: 'QUADS',
  Hamstrings: 'HAMSTRINGS',
  Glutes: 'GLUTES',
  Calves: 'CALVES',
  Abs: 'ABS',
} as const;
export type MuscleGroup = (typeof MuscleGroup)[keyof typeof MuscleGroup];

/** Agresividad del autoajuste: cuánto multiplica los saltos de carga. */
export const Aggressiveness = {
  Low: 'Baja',
  Medium: 'Media',
  High: 'Alta',
} as const;
export type Aggressiveness = (typeof Aggressiveness)[keyof typeof Aggressiveness];

/* ── Feedback subjetivo post-ejercicio ─────────────────────────────────────
 * Los cuatro ejes del prototipo. Los valores son los literales que el atleta
 * ve en pantalla: se persisten tal cual para que el histórico no dependa de
 * una tabla de traducción. Si algún día hay i18n, se traduce al renderizar.
 */

export const JointPain = {
  None: 'Ninguno',
  Little: 'Poco',
  Moderate: 'Moderado',
  Severe: 'Mucho',
} as const;
export type JointPain = (typeof JointPain)[keyof typeof JointPain];

export const Soreness = {
  Never: 'Nunca me dolió',
  GoneDaysAgo: 'Se fue hace días',
  GoneJustInTime: 'Se fue justo a tiempo',
  StillSore: 'Aún me duele',
} as const;
export type Soreness = (typeof Soreness)[keyof typeof Soreness];

export const Pump = {
  Low: 'Bajo',
  Moderate: 'Moderado',
  Amazing: 'Increíble',
} as const;
export type Pump = (typeof Pump)[keyof typeof Pump];

export const WorkloadFeel = {
  NotEnough: 'Insuficiente',
  Right: 'Justo',
  AtLimit: 'Al límite',
  TooMuch: 'Demasiado',
} as const;
export type WorkloadFeel = (typeof WorkloadFeel)[keyof typeof WorkloadFeel];

export interface Feedback {
  joint: JointPain;
  soreness: Soreness;
  pump: Pump;
  volume: WorkloadFeel;
}

/** Tipo de set. Myorep y Myorep Match aún no están implementados en el motor. */
export const SetType = {
  Regular: 'regular',
  Myorep: 'myorep',
  MyorepMatch: 'myorep_match',
} as const;
export type SetType = (typeof SetType)[keyof typeof SetType];

/* ── Ejercicio y rendimiento previo ───────────────────────────────────────── */

/** Lo que el atleta hizo la última vez que entrenó este ejercicio. */
export interface LastPerformance {
  /** Carga del top set, en kg. */
  weightKg: number;
  /** Repeticiones del top set. */
  reps: number;
  /** RIR con el que cerró el top set. */
  rir: number;
  /** Hard sets realizados. */
  sets: number;
  /** Feedback que reportó al terminar el ejercicio. */
  feedback: Feedback;
}

/** Prescripción de un ejercicio dentro de un mesociclo. */
export interface Exercise {
  id: string;
  name: string;
  muscle: MuscleGroup;
  /** Texto libre: material y detalles de montaje ("Dumbbell · banco 30°"). */
  equipment: string;
  /** Rango de repeticiones objetivo. */
  repLo: number;
  repHi: number;
  /** RIR objetivo del top set. */
  targetRir: number;
  /** Salto mínimo de carga disponible, en kg (mancuernas 2.5, cable 1.25…). */
  loadIncrementKg: number;
  last: LastPerformance;
}

/* ── Salida del motor ─────────────────────────────────────────────────────── */

/** Plan semanal del ejercicio: qué carga y cuántos hard sets tocan hoy. */
export interface ExercisePlan {
  /** Carga objetivo del primer set, en kg. */
  loadKg: number;
  /** Hard sets programados. */
  sets: number;
  /** loadKg − last.weightKg. Positivo sube, negativo baja. */
  deltaKg: number;
  /** '+1 set' | '−1 set' (U+2212) | null. */
  setNote: SetNote;
  /** Motivo del set añadido, vacío si no se añadió ninguno. */
  addReason: string;
  /** Explicación en lenguaje natural, separada por ' · '. Viaja hasta la UI. */
  why: string;
  /** e1RM estimado a partir del rendimiento previo. */
  e1rm: number;
  /** e1RM proyectado si se cumple el plan. */
  e1rmNext: number;
  /** Versión de política con la que se generó este plan. */
  policyVersion: string;
}

export type SetNote = '+1 set' | '−1 set' | null;

/** Lo que el atleta ya registró hoy en un set concreto. */
export interface SetLogEntry {
  /** Carga registrada en kg. null = no tocada por el atleta. */
  weightKg: number | null;
  /** Reps tal como las tecleó el atleta. String por fidelidad con el input. */
  reps: string | null;
  /** RPE opcional. */
  rpe?: string | null;
  /** Sub-sets opcionales (myorep). */
  subSets?: string | null;
  done: boolean;
}

/** Objetivo de un set individual, ya recalculado con lo registrado hoy. */
export interface SetPlan {
  /** Índice 0-based dentro del ejercicio. */
  index: number;
  /** Carga sugerida, en kg. */
  targetWeightKg: number;
  /** Repeticiones sugeridas. */
  targetReps: number;
  /** Por qué esta sugerencia. */
  why: string;
  /** Eco de lo registrado por el atleta, para que la UI pinte sin cruzar arrays. */
  loggedWeightKg: number | null;
  loggedReps: string | null;
  loggedRpe: string | null;
  loggedSubSets: string | null;
  done: boolean;
}

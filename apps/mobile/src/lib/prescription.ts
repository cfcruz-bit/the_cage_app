/**
 * Prescripción: lo que el coach manda para un ejercicio.
 *
 * El reparto de autoridad de la app, en una frase: **el motor sugiere, el coach
 * decide, el atleta ejecuta**. Cuando el coach fija un valor, ese valor gana
 * sobre el del motor; donde no lo fija (null), manda el motor.
 *
 * Esto mantiene vivo el motor de autorregulación sin quitarle el control al
 * coach: en su pantalla de edición ve siempre la sugerencia al lado de lo que
 * él puso, y puede volver a "automático" dejando el campo vacío.
 */

import {
  Exercise,
  ExercisePlan,
  planExercise,
  planSets,
  Aggressiveness,
  SetLogEntry,
  SetPlan,
} from '@cage/engine';

export interface Prescription {
  exerciseId: string;
  /** Hard sets. null = los que decida el motor. */
  sets: number | null;
  /** Carga de partida en kg. null = la que calcule el motor. */
  loadKg: number | null;
  /** Rango de repeticiones. null = el del ejercicio. */
  repLo: number | null;
  repHi: number | null;
  /** RIR objetivo. null = el del ejercicio. */
  targetRir: number | null;
  /** Descanso entre series, en segundos. Siempre lo pauta el coach. */
  restSeconds: number;
}

export const DEFAULT_REST_SECONDS = 150;

export function emptyPrescription(exerciseId: string): Prescription {
  return {
    exerciseId,
    sets: null,
    loadKg: null,
    repLo: null,
    repHi: null,
    targetRir: null,
    restSeconds: DEFAULT_REST_SECONDS,
  };
}

/** ¿El coach ha tocado algo, o está todo en automático? */
export function isAutomatic(p: Prescription | undefined): boolean {
  if (!p) return true;
  return (
    p.sets == null &&
    p.loadKg == null &&
    p.repLo == null &&
    p.repHi == null &&
    p.targetRir == null
  );
}

/**
 * Ejercicio con el rango y el RIR que puso el coach. El motor trabaja sobre
 * esta versión, así que sus sugerencias ya respetan la prescripción.
 */
export function applyPrescription(ex: Exercise, p: Prescription | undefined): Exercise {
  if (!p) return ex;
  return {
    ...ex,
    repLo: p.repLo ?? ex.repLo,
    repHi: p.repHi ?? ex.repHi,
    targetRir: p.targetRir ?? ex.targetRir,
  };
}

export interface EffectivePlan {
  /** Lo que se ejecuta hoy, ya con la prescripción aplicada. */
  plan: ExercisePlan;
  sets: SetPlan[];
  /** Lo que el motor habría hecho por su cuenta. Para que el coach compare. */
  suggestion: ExercisePlan;
  /** Campos que el coach fijó a mano. */
  overridden: { sets: boolean; load: boolean; reps: boolean; rir: boolean };
}

/**
 * Resuelve el plan de hoy combinando motor y prescripción.
 *
 * @param exercise  Prescripción base + rendimiento de la última sesión.
 * @param p         Lo que mandó el coach, si mandó algo.
 * @param aggressiveness  Preferencia del atleta (no la toca el coach).
 * @param log       Lo registrado hoy.
 */
export function resolvePlan(
  exercise: Exercise,
  p: Prescription | undefined,
  aggressiveness: Aggressiveness,
  log: ReadonlyArray<SetLogEntry | undefined>,
): EffectivePlan {
  const effectiveExercise = applyPrescription(exercise, p);
  const suggestion = planExercise(effectiveExercise, aggressiveness);

  const loadKg = p?.loadKg ?? suggestion.loadKg;
  const sets = p?.sets ?? suggestion.sets;

  const overridden = {
    sets: p?.sets != null,
    load: p?.loadKg != null,
    reps: p?.repLo != null || p?.repHi != null,
    rir: p?.targetRir != null,
  };

  const touched = overridden.sets || overridden.load;

  const plan: ExercisePlan = touched
    ? {
        ...suggestion,
        loadKg,
        sets,
        deltaKg: round2(loadKg - exercise.last.weightKg),
        why: whyFromCoach(overridden, suggestion.why),
      }
    : suggestion;

  return {
    plan,
    sets: planSets(effectiveExercise, plan, log),
    suggestion,
    overridden,
  };
}

function whyFromCoach(
  o: EffectivePlan['overridden'],
  engineWhy: string,
): string {
  if (o.load && o.sets) return 'carga y volumen pautados por tu coach';
  if (o.load) return 'carga pautada por tu coach';
  if (o.sets) return `${engineWhy} · volumen pautado por tu coach`;
  return engineWhy;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** "2:30" a partir de segundos. */
export function formatRest(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

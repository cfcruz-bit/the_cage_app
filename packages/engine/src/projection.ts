/**
 * Proyección del mesociclo.
 *
 * El prototipo dibujaba la tabla de progresión semanal con la lógica mezclada
 * dentro del render (colores de punto, strings de porcentaje). Aquí queda solo
 * la parte numérica; el color y el formato son decisión de la UI.
 *
 * La semana actual es el plan real que devuelve planExercise; las anteriores y
 * posteriores se extrapolan en saltos de un incremento, y la última semana es
 * el deload.
 */

import { Exercise, ExercisePlan } from './types.js';
import { clamp, roundTo } from './math.js';
import { MIN_HARD_SETS } from './policy.js';

/** Porcentaje de la carga que se mantiene en la semana de deload. */
export const DELOAD_LOAD_FACTOR = 0.75;
/** Hard sets durante el deload. */
export const DELOAD_SETS = 2;
/** RIR objetivo durante el deload: muy lejos del fallo. */
export const DELOAD_RIR = 4;

export interface ProjectedWeek {
  /** Índice 0-based dentro del mesociclo. */
  index: number;
  /** Número de semana para mostrar (1-based), o null si es el deload. */
  weekNumber: number | null;
  isDeload: boolean;
  sets: number;
  repLo: number;
  repHi: number;
  loadKg: number;
  /** RIR objetivo de esa semana: baja a medida que avanza el mesociclo. */
  targetRir: number;
  /** Carga como fracción del e1RM de referencia (0–1). */
  intensityRatio: number;
}

export interface ProjectionOptions {
  /** Semanas totales incluyendo el deload. Por defecto 7 (6 + deload). */
  totalWeeks?: number;
  /** Índice 0-based de la semana en curso. Por defecto 4. */
  currentWeekIndex?: number;
}

/**
 * Extrapola la progresión de un ejercicio a lo largo del mesociclo.
 *
 * @param exercise  Prescripción del ejercicio.
 * @param plan      Plan de la semana en curso (el ancla de la proyección).
 */
export function projectMesocycle(
  exercise: Exercise,
  plan: ExercisePlan,
  options: ProjectionOptions = {},
): ProjectedWeek[] {
  const totalWeeks = options.totalWeeks ?? 7;
  const current = options.currentWeekIndex ?? 4;
  const lastIndex = totalWeeks - 1;

  return Array.from({ length: totalWeeks }, (_, i) => {
    const isDeload = i === lastIndex;

    if (isDeload) {
      return {
        index: i,
        weekNumber: null,
        isDeload: true,
        sets: DELOAD_SETS,
        repLo: exercise.repLo,
        repHi: exercise.repLo,
        loadKg: roundTo(plan.loadKg * DELOAD_LOAD_FACTOR, exercise.loadIncrementKg),
        targetRir: DELOAD_RIR,
        intensityRatio: ratio(
          roundTo(plan.loadKg * DELOAD_LOAD_FACTOR, exercise.loadIncrementKg),
          plan.e1rm,
        ),
      };
    }

    const offset = i - current;
    const loadKg = roundTo(
      plan.loadKg + offset * exercise.loadIncrementKg,
      exercise.loadIncrementKg,
    );

    return {
      index: i,
      weekNumber: i + 1,
      isDeload: false,
      sets: clamp(plan.sets + offset, MIN_HARD_SETS, plan.sets + 2),
      repLo: exercise.repLo,
      repHi: exercise.repHi,
      loadKg,
      targetRir: clamp(3 - Math.floor(i * 0.6), 0, 3),
      intensityRatio: ratio(loadKg, plan.e1rm),
    };
  });
}

function ratio(loadKg: number, reference: number): number {
  const base = reference || loadKg;
  return Math.round((loadKg / base) * 1e4) / 1e4;
}

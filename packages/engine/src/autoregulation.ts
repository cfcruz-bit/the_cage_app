/**
 * Motor de autorregulación de The Cage 2.0.
 *
 * Port literal de la lógica del prototipo (planExercise / planSets), tipado y
 * con las constantes extraídas a policy.ts. NINGUNA regla ha sido modificada:
 * si un número aquí no cuadra con el prototipo, es un bug de este archivo.
 *
 * Estas funciones son puras: reciben datos y devuelven datos. No leen estado,
 * no tocan red ni base de datos, no formatean unidades. Por eso el mismo
 * código se puede ejecutar en el teléfono (cálculo optimista sin señal) y en
 * el servidor (fuente de verdad).
 */

import {
  Aggressiveness,
  Exercise,
  ExercisePlan,
  Feedback,
  JointPain,
  Pump,
  SetLogEntry,
  SetNote,
  SetPlan,
  Soreness,
  WorkloadFeel,
} from './types';
import {
  AGGRESSIVENESS_FACTOR,
  AT_LIMIT_MAX_STEPS,
  JOINT_PAIN_LOAD_FACTOR,
  MIN_HARD_SETS,
  POLICY_VERSION,
  REASONS,
  REASON_SEPARATOR,
} from './policy';
import { clamp, e1rm, roundHalfUp, roundTo } from './math';

/**
 * Decide la carga y el número de hard sets de un ejercicio para esta semana.
 *
 * El orden de las reglas importa y es el del prototipo:
 *   1. Holgura de RIR y tope de reps acumulan "pasos" de subida.
 *   2. El feedback de volumen/pump ajusta el número de sets.
 *   3. "Al límite" tapa los pasos; "Demasiado" quita un set.
 *   4. Se calcula la carga con los pasos ya multiplicados por la agresividad.
 *   5. Dolor articular severo y soreness persistente SOBRESCRIBEN todo lo
 *      anterior, incluidas las explicaciones acumuladas.
 *
 * @param exercise   Prescripción + rendimiento de la última sesión.
 * @param aggressiveness  Preferencia del atleta.
 * @param feedbackOverride  Feedback hipotético, para el preview en vivo del
 *                          bottom sheet ("si marco esto, ¿qué pasa la semana
 *                          que viene?"). Si se omite, usa el feedback real.
 */
export function planExercise(
  exercise: Exercise,
  aggressiveness: Aggressiveness,
  feedbackOverride?: Feedback,
): ExercisePlan {
  const last = exercise.last;
  const fb = feedbackOverride ?? last.feedback;
  const factor = AGGRESSIVENESS_FACTOR[aggressiveness];

  let why: string[] = [];
  let steps = 0;

  // 1. Señales de progresión.
  const slack = last.rir - exercise.targetRir;
  if (slack > 0) {
    steps += slack;
    why.push(REASONS.rirSlack(last.rir, exercise.targetRir));
  }
  if (last.reps >= exercise.repHi) {
    steps += 1;
    why.push(REASONS.repCeiling(exercise.repHi));
  }
  if (slack < 0) {
    why.push(REASONS.rirOvershoot);
  }

  // 2 y 3. Ajuste de volumen por feedback subjetivo.
  let sets = last.sets;
  let setNote: SetNote = null;
  let addReason = '';

  if (fb.volume === WorkloadFeel.NotEnough) {
    sets = last.sets + 1;
    setNote = '+1 set';
    addReason = REASONS.volumeInsufficient;
  } else if (fb.pump === Pump.Low) {
    sets = last.sets + 1;
    setNote = '+1 set';
    addReason = REASONS.lowPump;
  }

  if (fb.volume === WorkloadFeel.AtLimit) {
    steps = Math.min(steps, AT_LIMIT_MAX_STEPS);
  }
  if (fb.volume === WorkloadFeel.TooMuch) {
    sets = Math.max(MIN_HARD_SETS, last.sets - 1);
    setNote = '−1 set';
  }

  // 4. Carga resultante.
  let loadKg = roundTo(
    last.weightKg + roundHalfUp(steps * factor) * exercise.loadIncrementKg,
    exercise.loadIncrementKg,
  );

  // 5. Vetos por dolor. Sobrescriben carga, sets y explicación.
  if (fb.joint === JointPain.Severe) {
    loadKg = roundTo(last.weightKg * JOINT_PAIN_LOAD_FACTOR, exercise.loadIncrementKg);
    sets = Math.max(MIN_HARD_SETS, sets - 1);
    setNote = '−1 set';
    why = [REASONS.jointPain];
  } else if (fb.soreness === Soreness.StillSore) {
    loadKg = last.weightKg;
    why = [REASONS.stillSore];
  }

  if (why.length === 0) {
    why.push(REASONS.noSignal);
  }

  return {
    loadKg,
    sets,
    deltaKg: round6(loadKg - last.weightKg),
    setNote,
    addReason,
    why: why.join(REASON_SEPARATOR),
    e1rm: e1rm(last.weightKg, last.reps, last.rir),
    e1rmNext: e1rm(loadKg, clamp(last.reps, exercise.repLo, exercise.repHi), exercise.targetRir),
    policyVersion: POLICY_VERSION,
  };
}

/**
 * Reparte el plan semanal set a set, recalculando con lo que el atleta YA
 * registró hoy. Es lo que hace que la app reaccione dentro de la sesión y no
 * solo entre semanas.
 *
 * Reglas set a set (a partir del segundo):
 *   - Si el set anterior cayó por debajo del rango → back-off de un incremento.
 *   - Si superó el tope del rango → sube un incremento.
 *   - Si quedó dentro → misma carga, una rep menos por fatiga.
 *   - Si el set anterior no está registrado → se asume caída de ~1 rep.
 *
 * @param exercise  Prescripción del ejercicio.
 * @param plan      Salida de planExercise para este mismo ejercicio.
 * @param log       Lo registrado hoy, indexado por número de set.
 */
export function planSets(
  exercise: Exercise,
  plan: ExercisePlan,
  log: ReadonlyArray<SetLogEntry | undefined> = [],
): SetPlan[] {
  const out: SetPlan[] = [];
  let load = plan.loadKg;
  let reps = clamp(firstSetReps(exercise, plan), exercise.repLo, exercise.repHi);

  for (let i = 0; i < plan.sets; i++) {
    const entry: SetLogEntry = log[i] ?? { weightKg: null, reps: null, done: false };
    let why: string;

    if (i === 0) {
      why = plan.why;
    } else {
      const prevEntry = log[i - 1];
      const prevPlan = out[i - 1];

      if (prevEntry && prevEntry.done) {
        const prevReps = parseInt(prevEntry.reps ?? '', 10) || 0;
        const prevWeight = prevEntry.weightKg;
        const base = prevWeight == null || Number.isNaN(prevWeight)
          ? (prevPlan?.targetWeightKg ?? load)
          : prevWeight;

        if (prevReps < exercise.repLo) {
          load = roundTo(
            Math.max(exercise.loadIncrementKg, base - exercise.loadIncrementKg),
            exercise.loadIncrementKg,
          );
          reps = exercise.repLo;
          why = REASONS.backOff(exercise.repLo);
        } else if (prevReps > exercise.repHi) {
          load = roundTo(base + exercise.loadIncrementKg, exercise.loadIncrementKg);
          reps = exercise.repHi;
          why = REASONS.loadUp;
        } else {
          load = base;
          reps = clamp(prevReps - 1, exercise.repLo, exercise.repHi);
          why = REASONS.fatigueDrop;
        }
      } else {
        reps = clamp(reps - 1, exercise.repLo, exercise.repHi);
        why = REASONS.expectedDrop;
      }
    }

    // El último set, cuando fue añadido por feedback, explica por qué existe.
    if (i === plan.sets - 1 && plan.setNote === '+1 set') {
      why = REASONS.addedSet(plan.addReason);
    }

    out.push({
      index: i,
      targetWeightKg: load,
      targetReps: reps,
      why,
      loggedWeightKg: entry.weightKg,
      loggedReps: entry.reps,
      loggedRpe: entry.rpe ?? null,
      loggedSubSets: entry.subSets ?? null,
      done: !!entry.done,
    });
  }

  return out;
}

/**
 * Reps objetivo del primer set. Si la carga sube, se espera una rep menos que
 * la semana pasada; si baja, una más; si se mantiene, las mismas.
 */
export function firstSetReps(exercise: Exercise, plan: ExercisePlan): number {
  if (plan.deltaKg > 0) return exercise.last.reps - 1;
  if (plan.deltaKg < 0) return exercise.last.reps + 1;
  return exercise.last.reps;
}

/** Limpia el ruido de coma flotante de una resta de cargas. */
function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * Datos de referencia extraídos del prototipo.
 *
 * NO son datos de producción: son las fixtures que anclan los tests y el
 * contrato entre la implementación TypeScript y la de Python. Los tres
 * ejercicios son exactamente los que tenía el array EX del HTML, con su último
 * rendimiento y su feedback. Si cambian, los casos golden dejan de valer.
 */

import {
  Aggressiveness,
  Exercise,
  Feedback,
  JointPain,
  MuscleGroup,
  Pump,
  Soreness,
  WorkloadFeel,
} from './types.js';

export const DEFAULT_FEEDBACK: Feedback = {
  joint: JointPain.None,
  soreness: Soreness.GoneJustInTime,
  pump: Pump.Amazing,
  volume: WorkloadFeel.Right,
};

export const PROTOTYPE_EXERCISES: Exercise[] = [
  {
    id: 'ex-cuffed-lateral-raise',
    name: 'Cuffed Lateral Raise (unilateral)',
    muscle: MuscleGroup.Shoulders,
    equipment: 'Cable',
    repLo: 10,
    repHi: 15,
    targetRir: 2,
    loadIncrementKg: 2.5,
    last: {
      weightKg: 25,
      reps: 15,
      rir: 2,
      sets: 3,
      feedback: {
        joint: JointPain.None,
        soreness: Soreness.GoneDaysAgo,
        pump: Pump.Low,
        volume: WorkloadFeel.NotEnough,
      },
    },
  },
  {
    id: 'ex-incline-dumbbell-press',
    name: 'Incline Dumbbell Press',
    muscle: MuscleGroup.Chest,
    equipment: 'Dumbbell · banco 30°',
    repLo: 6,
    repHi: 10,
    targetRir: 2,
    loadIncrementKg: 2.5,
    last: {
      weightKg: 32.5,
      reps: 10,
      rir: 2,
      sets: 3,
      feedback: {
        joint: JointPain.None,
        soreness: Soreness.GoneJustInTime,
        pump: Pump.Amazing,
        volume: WorkloadFeel.Right,
      },
    },
  },
  {
    id: 'ex-neutral-grip-cable-pushdown',
    name: 'Neutral Grip Cable Pushdown',
    muscle: MuscleGroup.Triceps,
    equipment: 'Cable · cuerda',
    repLo: 10,
    repHi: 15,
    targetRir: 1,
    loadIncrementKg: 1.25,
    last: {
      weightKg: 27.5,
      reps: 12,
      rir: 1,
      sets: 3,
      feedback: {
        joint: JointPain.Little,
        soreness: Soreness.GoneJustInTime,
        pump: Pump.Moderate,
        volume: WorkloadFeel.AtLimit,
      },
    },
  },
];

export const ALL_AGGRESSIVENESS: Aggressiveness[] = [
  Aggressiveness.Low,
  Aggressiveness.Medium,
  Aggressiveness.High,
];

/** Busca una fixture por id. Lanza si no existe, para que un typo falle rápido. */
export function fixture(id: string): Exercise {
  const found = PROTOTYPE_EXERCISES.find((e) => e.id === id);
  if (!found) throw new Error(`Fixture desconocida: ${id}`);
  return clone(found);
}

/** Copia profunda sin depender de structuredClone (no está en todos los runtimes de RN). */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

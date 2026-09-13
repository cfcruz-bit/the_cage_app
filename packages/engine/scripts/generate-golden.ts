/**
 * Genera golden/cases.json: el contrato ejecutable entre la implementación
 * TypeScript (app, cálculo optimista sin señal) y la de Python (backend,
 * fuente de verdad).
 *
 *   npm run golden
 *
 * El archivo resultante se versiona en git. En la Fase 2, el test de Python
 * lee este MISMO archivo y compara sus resultados: si las dos implementaciones
 * divergen, el CI falla antes de que un atleta entrene con el número malo.
 *
 * Regenerar cases.json solo está justificado cuando cambia una regla a
 * propósito. Si cambia por accidente, el diff de este archivo es la alarma.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALL_AGGRESSIVENESS,
  Aggressiveness,
  Exercise,
  Feedback,
  JointPain,
  POLICY_VERSION,
  PROTOTYPE_EXERCISES,
  clone,
  Pump,
  SetLogEntry,
  Soreness,
  WorkloadFeel,
  planExercise,
  planSets,
  projectMesocycle,
} from '../src/index';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'golden', 'cases.json');

/** Combinaciones de feedback que ejercitan cada rama del motor. */
const FEEDBACK_MATRIX: Array<{ id: string; feedback: Feedback }> = [
  {
    id: 'neutral',
    feedback: {
      joint: JointPain.None,
      soreness: Soreness.GoneJustInTime,
      pump: Pump.Amazing,
      volume: WorkloadFeel.Right,
    },
  },
  {
    id: 'volumen-insuficiente',
    feedback: {
      joint: JointPain.None,
      soreness: Soreness.GoneDaysAgo,
      pump: Pump.Moderate,
      volume: WorkloadFeel.NotEnough,
    },
  },
  {
    id: 'pump-bajo',
    feedback: {
      joint: JointPain.None,
      soreness: Soreness.GoneJustInTime,
      pump: Pump.Low,
      volume: WorkloadFeel.Right,
    },
  },
  {
    id: 'al-limite',
    feedback: {
      joint: JointPain.Little,
      soreness: Soreness.GoneJustInTime,
      pump: Pump.Amazing,
      volume: WorkloadFeel.AtLimit,
    },
  },
  {
    id: 'demasiado',
    feedback: {
      joint: JointPain.None,
      soreness: Soreness.GoneJustInTime,
      pump: Pump.Amazing,
      volume: WorkloadFeel.TooMuch,
    },
  },
  {
    id: 'dolor-articular-severo',
    feedback: {
      joint: JointPain.Severe,
      soreness: Soreness.GoneJustInTime,
      pump: Pump.Amazing,
      volume: WorkloadFeel.NotEnough,
    },
  },
  {
    id: 'aun-adolorido',
    feedback: {
      joint: JointPain.None,
      soreness: Soreness.StillSore,
      pump: Pump.Amazing,
      volume: WorkloadFeel.Right,
    },
  },
];

/** Rendimientos previos que fuerzan las ramas de progresión. */
const PERFORMANCE_VARIANTS = [
  { id: 'tal-cual', patch: {} },
  { id: 'holgura-rir', patch: { rir: 4 } },
  { id: 'exceso-rir', patch: { rir: 0 } },
  { id: 'reps-bajas', patch: { reps: 6 } },
];

/** Escenarios de registro dentro de la sesión. */
const LOG_SCENARIOS: Array<{ id: string; log: Array<SetLogEntry | null> }> = [
  { id: 'sin-registro', log: [] },
  { id: 'set1-en-rango', log: [{ weightKg: null, reps: null, done: false }] },
  { id: 'set1-por-debajo', log: [{ weightKg: 20, reps: '4', done: true }] },
  { id: 'set1-por-encima', log: [{ weightKg: 20, reps: '30', done: true }] },
  { id: 'set1-sin-peso', log: [{ weightKg: null, reps: '12', done: true }] },
  { id: 'set1-reps-invalidas', log: [{ weightKg: 20, reps: '', done: true }] },
  {
    id: 'dos-sets-hechos',
    log: [
      { weightKg: 30, reps: '12', done: true },
      { weightKg: 30, reps: '9', done: true },
    ],
  },
];

interface Case {
  id: string;
  input: {
    exercise: Exercise;
    aggressiveness: Aggressiveness;
    feedbackOverride: Feedback | null;
    log: Array<SetLogEntry | null>;
  };
  expected: {
    plan: ReturnType<typeof planExercise>;
    sets: ReturnType<typeof planSets>;
    projection: ReturnType<typeof projectMesocycle>;
  };
}

const cases: Case[] = [];

for (const base of PROTOTYPE_EXERCISES) {
  for (const perf of PERFORMANCE_VARIANTS) {
    const exercise: Exercise = {
      ...clone(base),
      last: { ...clone(base.last), ...perf.patch },
    };

    for (const aggressiveness of ALL_AGGRESSIVENESS) {
      for (const fb of FEEDBACK_MATRIX) {
        for (const scenario of LOG_SCENARIOS) {
          const log = scenario.log.map((e) => (e ? { ...e } : null));
          const plan = planExercise(exercise, aggressiveness, fb.feedback);
          const sets = planSets(
            exercise,
            plan,
            log.map((e) => e ?? undefined),
          );

          cases.push({
            id: [base.id, perf.id, aggressiveness, fb.id, scenario.id].join('|'),
            input: {
              exercise: clone(exercise),
              aggressiveness,
              feedbackOverride: fb.feedback,
              log,
            },
            expected: {
              plan,
              sets,
              projection: projectMesocycle(exercise, plan),
            },
          });
        }
      }
    }
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      policyVersion: POLICY_VERSION,
      generatedBy: '@cage/engine scripts/generate-golden.ts',
      note:
        'Contrato entre las implementaciones TS y Python. No editar a mano: ' +
        'regenerar con `npm run golden` solo cuando una regla cambie a proposito.',
      caseCount: cases.length,
      cases,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);

console.log(`golden/cases.json · ${cases.length} casos · política ${POLICY_VERSION}`);

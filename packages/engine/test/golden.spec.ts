import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  POLICY_VERSION,
  planExercise,
  planSets,
  projectMesocycle,
} from '../src/index.js';

/**
 * Test de regresión sobre golden/cases.json.
 *
 * Si este test falla, una regla del motor cambió. Eso no es necesariamente un
 * error — pero tiene que ser una decisión consciente: sube POLICY_VERSION,
 * regenera con `npm run golden` y revisa el diff caso por caso antes de
 * mergear. El backend Python corre este mismo archivo en la Fase 2.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = resolve(HERE, '..', 'golden', 'cases.json');

const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as {
  policyVersion: string;
  caseCount: number;
  cases: Array<{
    id: string;
    input: any;
    expected: { plan: any; sets: any; projection: any };
  }>;
};

describe('golden/cases.json', () => {
  it('se generó con la versión de política vigente', () => {
    expect(golden.policyVersion).toBe(POLICY_VERSION);
  });

  it('cubre toda la matriz de casos', () => {
    expect(golden.cases).toHaveLength(golden.caseCount);
    expect(golden.caseCount).toBeGreaterThan(500);
  });

  it.each(golden.cases.map((c) => [c.id, c] as const))('%s', (_id, testCase) => {
    const { exercise, aggressiveness, feedbackOverride, log } = testCase.input;

    const plan = planExercise(exercise, aggressiveness, feedbackOverride ?? undefined);
    expect(plan).toEqual(testCase.expected.plan);

    const sets = planSets(
      exercise,
      plan,
      (log as Array<any>).map((e) => e ?? undefined),
    );
    expect(sets).toEqual(testCase.expected.sets);

    expect(projectMesocycle(exercise, plan)).toEqual(testCase.expected.projection);
  });
});

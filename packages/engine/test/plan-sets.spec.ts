import { describe, expect, it } from 'vitest';
import {
  Aggressiveness,
  Exercise,
  JointPain,
  MuscleGroup,
  Pump,
  SetLogEntry,
  Soreness,
  WorkloadFeel,
  fixture,
  planExercise,
  planSets,
} from '../src/index';

function lab(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'lab',
    name: 'Lab Press',
    muscle: MuscleGroup.Chest,
    equipment: 'Machine',
    repLo: 8,
    repHi: 12,
    targetRir: 2,
    loadIncrementKg: 5,
    last: {
      weightKg: 100,
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
    ...overrides,
  };
}

function done(weightKg: number | null, reps: string): SetLogEntry {
  return { weightKg, reps, done: true };
}

describe('planSets · sin nada registrado', () => {
  const ex = lab();
  const plan = planExercise(ex, Aggressiveness.Medium);
  const sets = planSets(ex, plan, []);

  it('emite tantos sets como programó el plan', () => {
    expect(sets).toHaveLength(plan.sets);
    expect(sets.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('el primer set hereda la explicación del plan semanal', () => {
    expect(sets[0]!.why).toBe(plan.why);
    expect(sets[0]!.targetWeightKg).toBe(plan.loadKg);
  });

  it('asume una caída de ~1 rep por set mientras no haya registro', () => {
    expect(sets.map((s) => s.targetReps)).toEqual([10, 9, 8]);
    expect(sets[1]!.why).toBe('caída esperada de ~1 rep');
  });

  it('nunca baja de repLo aunque haya muchos sets', () => {
    const largo = lab({
      last: { ...lab().last, sets: 8, feedback: { ...lab().last.feedback } },
    });
    const p = planExercise(largo, Aggressiveness.Medium);
    const s = planSets(largo, p, []);
    expect(Math.min(...s.map((x) => x.targetReps))).toBe(largo.repLo);
  });
});

describe('planSets · reps objetivo del primer set', () => {
  it('espera una rep menos cuando la carga sube', () => {
    const ex = lab({ last: { ...lab().last, rir: 4 } });
    const plan = planExercise(ex, Aggressiveness.Medium);
    expect(plan.deltaKg).toBeGreaterThan(0);
    expect(planSets(ex, plan, [])[0]!.targetReps).toBe(9);
  });

  it('espera una rep más cuando la carga baja', () => {
    const ex = lab();
    const plan = planExercise(ex, Aggressiveness.Medium, {
      ...ex.last.feedback,
      joint: JointPain.Severe,
    });
    expect(plan.deltaKg).toBeLessThan(0);
    expect(planSets(ex, plan, [])[0]!.targetReps).toBe(11);
  });
});

describe('planSets · reacción dentro de la sesión', () => {
  const ex = lab();
  const plan = planExercise(ex, Aggressiveness.Medium);

  it('hace back-off cuando el set previo cayó por debajo del rango', () => {
    const sets = planSets(ex, plan, [done(100, '6')]);
    expect(sets[1]!.targetWeightKg).toBe(95);
    expect(sets[1]!.targetReps).toBe(8);
    expect(sets[1]!.why).toBe('back-off: el set previo cayó bajo 8 reps');
  });

  it('sube la carga cuando el set previo pasó el tope del rango', () => {
    const sets = planSets(ex, plan, [done(100, '14')]);
    expect(sets[1]!.targetWeightKg).toBe(105);
    expect(sets[1]!.targetReps).toBe(12);
    expect(sets[1]!.why).toBe('subes carga: pasaste el tope del rango');
  });

  it('mantiene la carga y resta una rep cuando el set previo quedó dentro', () => {
    const sets = planSets(ex, plan, [done(100, '10')]);
    expect(sets[1]!.targetWeightKg).toBe(100);
    expect(sets[1]!.targetReps).toBe(9);
    expect(sets[1]!.why).toBe('misma carga, −1 rep por fatiga acumulada');
  });

  it('parte de la carga que el atleta realmente usó, no de la sugerida', () => {
    const sets = planSets(ex, plan, [done(80, '10')]);
    expect(sets[1]!.targetWeightKg).toBe(80);
  });

  it('cae a la carga sugerida si el registro no trae peso', () => {
    const sets = planSets(ex, plan, [done(null, '10')]);
    expect(sets[1]!.targetWeightKg).toBe(plan.loadKg);
  });

  it('el back-off nunca deja la carga por debajo de un incremento', () => {
    const ligero = lab({ loadIncrementKg: 5, last: { ...lab().last, weightKg: 5 } });
    const p = planExercise(ligero, Aggressiveness.Medium);
    const sets = planSets(ligero, p, [done(5, '2')]);
    expect(sets[1]!.targetWeightKg).toBe(5);
  });

  it('ignora un set previo registrado pero no marcado como hecho', () => {
    const sets = planSets(ex, plan, [{ weightKg: 100, reps: '14', done: false }]);
    expect(sets[1]!.why).toBe('caída esperada de ~1 rep');
  });

  it('trata reps no numéricas como 0 y hace back-off', () => {
    const sets = planSets(ex, plan, [done(100, 'abc')]);
    expect(sets[1]!.why).toBe('back-off: el set previo cayó bajo 8 reps');
  });
});

describe('planSets · set añadido por feedback', () => {
  it('el último set explica que lo añadió el feedback de volumen', () => {
    const ex = lab();
    const plan = planExercise(ex, Aggressiveness.Medium, {
      ...ex.last.feedback,
      volume: WorkloadFeel.NotEnough,
    });
    const sets = planSets(ex, plan, []);
    expect(sets).toHaveLength(4);
    expect(sets[3]!.why).toBe('set añadido: reportaste volumen insuficiente');
  });
});

describe('planSets · eco del registro del atleta', () => {
  it('devuelve lo registrado junto a lo sugerido, sin mezclarlos', () => {
    const ex = fixture('ex-incline-dumbbell-press');
    const plan = planExercise(ex, Aggressiveness.Medium);
    const sets = planSets(ex, plan, [
      { weightKg: 35, reps: '9', rpe: '8', done: true },
    ]);

    expect(sets[0]!.loggedWeightKg).toBe(35);
    expect(sets[0]!.loggedReps).toBe('9');
    expect(sets[0]!.loggedRpe).toBe('8');
    expect(sets[0]!.done).toBe(true);
    expect(sets[1]!.loggedWeightKg).toBeNull();
    expect(sets[1]!.done).toBe(false);
  });
});

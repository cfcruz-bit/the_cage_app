import { describe, expect, it } from 'vitest';
import {
  Aggressiveness,
  Exercise,
  Feedback,
  JointPain,
  MuscleGroup,
  POLICY_VERSION,
  Pump,
  Soreness,
  WorkloadFeel,
  fixture,
  planExercise,
} from '../src/index.js';

/** Ejercicio de laboratorio: números redondos para que cada aserción sea legible. */
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
    last: { weightKg: 100, reps: 10, rir: 2, sets: 3, feedback: neutral() },
    ...overrides,
  };
}

function neutral(): Feedback {
  return {
    joint: JointPain.None,
    soreness: Soreness.GoneJustInTime,
    pump: Pump.Amazing,
    volume: WorkloadFeel.Right,
  };
}

describe('planExercise · señales de progresión', () => {
  it('no mueve la carga cuando no hay ninguna señal', () => {
    const plan = planExercise(lab(), Aggressiveness.Medium);
    expect(plan.loadKg).toBe(100);
    expect(plan.deltaKg).toBe(0);
    expect(plan.sets).toBe(3);
    expect(plan.why).toBe('sin señales para mover la carga');
  });

  it('sube un escalón por cada RIR de holgura sobre el objetivo', () => {
    const ex = lab({ last: { weightKg: 100, reps: 10, rir: 4, sets: 3, feedback: neutral() } });
    const plan = planExercise(ex, Aggressiveness.Medium);
    expect(plan.loadKg).toBe(110); // 2 de holgura × 5 kg
    expect(plan.why).toContain('cerraste en RIR 4 con objetivo 2');
  });

  it('suma un escalón extra al alcanzar el tope del rango de reps', () => {
    const ex = lab({ last: { weightKg: 100, reps: 12, rir: 3, sets: 3, feedback: neutral() } });
    const plan = planExercise(ex, Aggressiveness.Medium);
    expect(plan.loadKg).toBe(110); // 1 de holgura + 1 por tope
    expect(plan.why).toContain('llegaste al tope de 12 reps');
  });

  it('sostiene la carga si el atleta se pasó del RIR objetivo', () => {
    const ex = lab({ last: { weightKg: 100, reps: 10, rir: 0, sets: 3, feedback: neutral() } });
    const plan = planExercise(ex, Aggressiveness.Medium);
    expect(plan.loadKg).toBe(100);
    expect(plan.why).toBe('te pasaste del RIR objetivo, se sostiene la carga');
  });
});

describe('planExercise · agresividad', () => {
  const ex = lab({ last: { weightKg: 100, reps: 10, rir: 4, sets: 3, feedback: neutral() } });

  it('Baja redondea 2 pasos × 0.5 a 1 escalón', () => {
    expect(planExercise(ex, Aggressiveness.Low).loadKg).toBe(105);
  });

  it('Media aplica los pasos tal cual', () => {
    expect(planExercise(ex, Aggressiveness.Medium).loadKg).toBe(110);
  });

  it('Alta redondea 2 pasos × 1.5 a 3 escalones', () => {
    expect(planExercise(ex, Aggressiveness.High).loadKg).toBe(115);
  });

  it('redondea half-up: 1 paso × 0.5 sigue siendo 1 escalón', () => {
    const uno = lab({ last: { weightKg: 100, reps: 10, rir: 3, sets: 3, feedback: neutral() } });
    expect(planExercise(uno, Aggressiveness.Low).loadKg).toBe(105);
  });
});

describe('planExercise · feedback de volumen y pump', () => {
  it('añade un set con volumen insuficiente y explica por qué', () => {
    const fb = { ...neutral(), volume: WorkloadFeel.NotEnough };
    const plan = planExercise(lab(), Aggressiveness.Medium, fb);
    expect(plan.sets).toBe(4);
    expect(plan.setNote).toBe('+1 set');
    expect(plan.addReason).toBe('reportaste volumen insuficiente');
  });

  it('añade un set con pump bajo cuando el volumen se sintió justo', () => {
    const fb = { ...neutral(), pump: Pump.Low };
    const plan = planExercise(lab(), Aggressiveness.Medium, fb);
    expect(plan.sets).toBe(4);
    expect(plan.addReason).toBe('reportaste pump bajo');
  });

  it('el volumen insuficiente tiene prioridad sobre el pump bajo', () => {
    const fb = { ...neutral(), volume: WorkloadFeel.NotEnough, pump: Pump.Low };
    expect(planExercise(lab(), Aggressiveness.Medium, fb).addReason).toBe(
      'reportaste volumen insuficiente',
    );
  });

  it('"Al límite" tapa la subida a un solo escalón aunque haya más holgura', () => {
    const ex = lab({ last: { weightKg: 100, reps: 12, rir: 5, sets: 3, feedback: neutral() } });
    const fb = { ...neutral(), volume: WorkloadFeel.AtLimit };
    expect(planExercise(ex, Aggressiveness.Medium, fb).loadKg).toBe(105);
  });

  it('"Demasiado" quita un set sin bajar del suelo de 2', () => {
    const fb = { ...neutral(), volume: WorkloadFeel.TooMuch };
    expect(planExercise(lab(), Aggressiveness.Medium, fb).sets).toBe(2);

    const dosSets = lab({ last: { weightKg: 100, reps: 10, rir: 2, sets: 2, feedback: neutral() } });
    expect(planExercise(dosSets, Aggressiveness.Medium, fb).sets).toBe(2);
  });
});

describe('planExercise · vetos por dolor', () => {
  it('dolor articular severo recorta carga y volumen y borra el resto de motivos', () => {
    const ex = lab({ last: { weightKg: 100, reps: 12, rir: 4, sets: 3, feedback: neutral() } });
    const fb = { ...neutral(), joint: JointPain.Severe };
    const plan = planExercise(ex, Aggressiveness.High, fb);

    expect(plan.loadKg).toBe(95); // 100 × 0.95, redondeado al incremento de 5
    expect(plan.sets).toBe(2);
    expect(plan.setNote).toBe('−1 set');
    expect(plan.why).toBe('dolor articular alto: se recorta carga y volumen');
    expect(plan.deltaKg).toBeLessThan(0);
  });

  it('soreness persistente congela la carga', () => {
    const ex = lab({ last: { weightKg: 100, reps: 12, rir: 4, sets: 3, feedback: neutral() } });
    const fb = { ...neutral(), soreness: Soreness.StillSore };
    const plan = planExercise(ex, Aggressiveness.Medium, fb);

    expect(plan.loadKg).toBe(100);
    expect(plan.deltaKg).toBe(0);
    expect(plan.why).toBe('seguías adolorido: misma carga esta semana');
  });

  it('el dolor articular gana sobre el soreness', () => {
    const fb = { ...neutral(), joint: JointPain.Severe, soreness: Soreness.StillSore };
    expect(planExercise(lab(), Aggressiveness.Medium, fb).why).toBe(
      'dolor articular alto: se recorta carga y volumen',
    );
  });

  it('el veto de dolor no anula el set añadido por volumen insuficiente', () => {
    // Regla heredada del prototipo: sets llega a 4 por el feedback de volumen y
    // el dolor articular le resta uno, quedando en 3. Si esto cambia, es una
    // decisión de producto, no un refactor.
    const fb = { ...neutral(), joint: JointPain.Severe, volume: WorkloadFeel.NotEnough };
    expect(planExercise(lab(), Aggressiveness.Medium, fb).sets).toBe(3);
  });
});

describe('planExercise · e1RM y metadatos', () => {
  it('calcula el e1RM previo con Epley + RIR', () => {
    const plan = planExercise(lab(), Aggressiveness.Medium);
    expect(plan.e1rm).toBeCloseTo(100 * (1 + 12 / 30), 10); // 10 reps + 2 RIR
  });

  it('proyecta el e1RM con las reps acotadas al rango', () => {
    const ex = lab({ last: { weightKg: 100, reps: 20, rir: 2, sets: 3, feedback: neutral() } });
    const plan = planExercise(ex, Aggressiveness.Medium);
    expect(plan.e1rmNext).toBeCloseTo(plan.loadKg * (1 + 14 / 30), 10); // 12 reps + 2 RIR
  });

  it('sella cada plan con la versión de política', () => {
    expect(planExercise(lab(), Aggressiveness.Medium).policyVersion).toBe(POLICY_VERSION);
  });
});

describe('planExercise · fixtures del prototipo', () => {
  it('lateral raise: tope de reps + volumen insuficiente → +2.5 kg y 4 sets', () => {
    const plan = planExercise(fixture('ex-cuffed-lateral-raise'), Aggressiveness.Medium);
    expect(plan.loadKg).toBe(27.5);
    expect(plan.sets).toBe(4);
    expect(plan.setNote).toBe('+1 set');
  });

  it('incline press: tope de reps sin holgura de RIR → +2.5 kg, mismos sets', () => {
    const plan = planExercise(fixture('ex-incline-dumbbell-press'), Aggressiveness.Medium);
    expect(plan.loadKg).toBe(35);
    expect(plan.sets).toBe(3);
    expect(plan.setNote).toBeNull();
  });

  it('pushdown: sin señales y "Al límite" → carga y sets intactos', () => {
    const plan = planExercise(fixture('ex-neutral-grip-cable-pushdown'), Aggressiveness.Medium);
    expect(plan.loadKg).toBe(27.5);
    expect(plan.sets).toBe(3);
    expect(plan.why).toBe('sin señales para mover la carga');
  });
});

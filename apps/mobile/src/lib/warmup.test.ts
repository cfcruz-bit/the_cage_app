import { describe, expect, it } from 'vitest';
import { warmupSets } from './warmup';

describe('warmupSets', () => {
  it('barra sola y 50/70/85 % redondeado a 2,5 kg', () => {
    expect(warmupSets(102.5)).toEqual([
      { kg: 20, reps: 10 },
      { kg: 52.5, reps: 5 },
      { kg: 72.5, reps: 3 },
      { kg: 87.5, reps: 1 },
    ]);
  });

  it('con un top ligero no repite pesos ni baja de la barra', () => {
    expect(warmupSets(40)).toEqual([
      { kg: 20, reps: 10 },
      { kg: 27.5, reps: 3 },
      { kg: 35, reps: 1 },
    ]);
  });

  it('sin nada que aproximar si el top es la barra', () => {
    expect(warmupSets(20)).toEqual([]);
  });
});

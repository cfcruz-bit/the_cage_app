import { describe, expect, it } from 'vitest';
import { dropWeights, joinParts, splitParts } from './technique';

describe('dropWeights', () => {
  it('baja un % de la anterior y redondea al incremento', () => {
    expect(dropWeights(55, 2, 25, 2.5)).toEqual([55, 42.5, 32.5]);
    expect(dropWeights(200, 2, 25, 5)).toEqual([200, 150, 115]);
  });

  it('nunca baja de un incremento', () => {
    expect(dropWeights(5, 3, 50, 2.5)).toEqual([5, 2.5, 2.5, 2.5]);
  });

  it('sin incremento válido usa 2,5 kg', () => {
    expect(dropWeights(40, 1, 25, 0)).toEqual([40, 30]);
  });
});

describe('partes del set', () => {
  it('ida y vuelta entre lo que se ve y lo que se guarda', () => {
    expect(joinParts([10, 4, 3])).toEqual({ reps: '10', subSets: '4+3' });
    expect(splitParts('10', '4+3')).toEqual([10, 4, 3]);
  });

  it('un set sin partes no guarda sub_sets', () => {
    expect(joinParts([8])).toEqual({ reps: '8', subSets: null });
    expect(splitParts('8', null)).toEqual([8]);
  });
});

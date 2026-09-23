import { describe, expect, it } from 'vitest';

import { dayHeading, dayLabel, emptyDays, groupByDay, layoutSummary, nextUpText } from './days';

const days = [
  { dayNumber: 1, name: 'Empuje' },
  { dayNumber: 3, name: 'Tirón' },
];

describe('nombres de día', () => {
  it('con nombre y sin nombre', () => {
    expect(dayLabel(1, days)).toBe('Día 1 · Empuje');
    expect(dayLabel(2, days)).toBe('Día 2');
    expect(dayHeading(3, days)).toBe('DÍA 3 · TIRÓN');
  });

  it('el resumen del reparto deja el día sin nombre como D2', () => {
    expect(layoutSummary(3, days)).toBe('3 días · D1 Empuje · D2 · D3 Tirón');
    expect(layoutSummary(1, [])).toBe('1 día · D1');
  });
});

describe('lo que le toca al atleta', () => {
  it('con y sin nombre de día', () => {
    expect(nextUpText({ weekNumber: 2, dayNumber: 2, dayName: 'Empuje' })).toBe(
      'Semana 2 · Día 2 · Empuje',
    );
    expect(nextUpText({ weekNumber: 1, dayNumber: 3, dayName: null })).toBe('Semana 1 · Día 3');
  });
});

describe('agrupar por día', () => {
  it('ordena los días y conserva el orden dentro de cada uno', () => {
    const items = [
      { dayNumber: 2, n: 'a' },
      { dayNumber: 1, n: 'b' },
      { dayNumber: 2, n: 'c' },
    ];
    expect(groupByDay(items).map((g) => [g.dayNumber, g.items.map((i) => i.n)])).toEqual([
      [1, ['b']],
      [2, ['a', 'c']],
    ]);
  });
});

describe('días vacíos', () => {
  it('detecta los que se quedan sin ejercicios', () => {
    expect(emptyDays(4, [1, 1, 3])).toEqual([2, 4]);
    expect(emptyDays(2, [1, 2])).toEqual([]);
  });
});

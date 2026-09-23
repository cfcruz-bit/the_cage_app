/**
 * Los días de entrenamiento de un mesociclo: cómo se nombran y se agrupan.
 *
 * Un día tiene número y, si el coach quiso, nombre ("Empuje"). Sin nombre es
 * "Día N". Todo texto de día sale de aquí para que la tabla, el sheet de
 * creación, la lista de mesociclos y la pantalla del atleta lo digan igual.
 */

export interface DayName {
  dayNumber: number;
  name: string;
}

/** El nombre que puso el coach, o null si el día no tiene. */
export function nameOfDay(dayNumber: number, days: DayName[]): string | null {
  return days.find((d) => d.dayNumber === dayNumber)?.name ?? null;
}

/** "Día 2 · Empuje" | "Día 2". */
export function dayLabel(dayNumber: number, days: DayName[]): string {
  const name = nameOfDay(dayNumber, days);
  return name === null ? `Día ${dayNumber}` : `Día ${dayNumber} · ${name}`;
}

/** "Semana 2 · Día 2 · Empuje": lo que le toca al atleta. */
export function nextUpText(next: {
  weekNumber: number;
  dayNumber: number;
  dayName: string | null;
}): string {
  const day = next.dayName === null ? `Día ${next.dayNumber}` : `Día ${next.dayNumber} · ${next.dayName}`;
  return `Semana ${next.weekNumber} · ${day}`;
}

/** "DÍA 2 · EMPUJE": el encabezado de un grupo de ejercicios. */
export function dayHeading(dayNumber: number, days: DayName[]): string {
  return dayLabel(dayNumber, days).toUpperCase();
}

/** "3 días · D1 Empuje · D2 · D3 Tirón" (el día sin nombre va solo como D2). */
export function layoutSummary(daysPerWeek: number, days: DayName[]): string {
  const parts = Array.from({ length: daysPerWeek }, (_, i) => {
    const n = i + 1;
    const name = nameOfDay(n, days);
    return name === null ? `D${n}` : `D${n} ${name}`;
  });
  return [`${daysPerWeek} ${daysPerWeek === 1 ? 'día' : 'días'}`, ...parts].join(' · ');
}

/** Agrupa por día conservando el orden en que llegan dentro de cada uno. */
export function groupByDay<T extends { dayNumber: number }>(
  items: T[],
): { dayNumber: number; items: T[] }[] {
  const byDay = new Map<number, T[]>();
  for (const item of items) {
    const list = byDay.get(item.dayNumber);
    if (list === undefined) byDay.set(item.dayNumber, [item]);
    else list.push(item);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dayNumber, list]) => ({ dayNumber, items: list }));
}

/** Los días 1..daysPerWeek que no tienen ningún ejercicio asignado. */
export function emptyDays(daysPerWeek: number, assigned: number[]): number[] {
  const used = new Set(assigned);
  const empty: number[] = [];
  for (let d = 1; d <= daysPerWeek; d += 1) {
    if (!used.has(d)) empty.push(d);
  }
  return empty;
}

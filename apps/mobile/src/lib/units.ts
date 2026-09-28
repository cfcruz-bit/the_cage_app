/**
 * Conversión de unidades.
 *
 * INVARIANTE DEL SISTEMA: el estado, el motor y la base guardan SIEMPRE kg.
 * Este módulo es la única frontera donde aparecen las libras, y solo al pintar
 * o al leer un input. Si ves una libra en cualquier otro sitio, es un bug.
 */

export type Unit = 'kg' | 'lb';

const LB_PER_KG = 2.2046;

/** kg → unidad de visualización. Las libras se redondean a media libra. */
export function toDisplay(kg: number, unit: Unit): number {
  return unit === 'lb' ? Math.round(kg * LB_PER_KG * 2) / 2 : kg;
}

/** Unidad de visualización → kg, para guardar lo que teclea el atleta. */
export function toKg(value: number, unit: Unit): number {
  return unit === 'lb' ? Math.round((value / LB_PER_KG) * 100) / 100 : value;
}

/** "32.5 kg" — para etiquetas. */
export function formatLoad(kg: number, unit: Unit): string {
  const v = toDisplay(kg, unit);
  return `${trimZeros(v)} ${unit}`;
}

/** Sin " kg" al final: para inputs y celdas de tabla. */
export function formatNumber(kg: number, unit: Unit): string {
  return trimZeros(toDisplay(kg, unit));
}

function trimZeros(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/**
 * Lee lo que el atleta escribió en un input de peso.
 * Devuelve null si no hay un número válido — NUNCA 0 silencioso, que es el bug
 * H-05 del prototipo: escribir "abc" registraba un set de 0 kg sin avisar.
 */
export function parseWeightInput(raw: string, unit: Unit): number | null {
  const normalized = raw.replace(',', '.').trim();
  if (normalized === '') return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0 || n > 1000) return null;
  return toKg(n, unit);
}


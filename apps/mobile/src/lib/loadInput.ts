/**
 * Lee lo que el coach escribió en una celda de carga: puede ser un porcentaje
 * del 1RM o unos kilos directos. Se distingue por el símbolo `%`, nada más.
 *
 * Es una función pura a propósito: la usan tanto el paso 3 de
 * `NewMesoSheet.tsx` (una fila por semana de un básico) como la celda de
 * `PlanGrid.tsx`, y las dos necesitan el mismo criterio sin duplicarlo.
 */

import { type Unit, toKg } from '@/lib/units';

export type ParsedLoad =
  | { kind: 'percent'; value: number }
  | { kind: 'kg'; value: number }
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: string };

//: Mismo rango que `app/services/records.py::PERCENT_MIN/MAX` del servidor.
export const PERCENT_MIN = 30;
export const PERCENT_MAX = 110;

/**
 * Si el texto termina en `%` es un porcentaje del 1RM, sin depender de la
 * unidad de pantalla. Si no, es un peso — en la unidad que el atleta tenga
 * elegida, así que un número en libras se convierte a kg aquí, antes de que
 * salga de este módulo.
 */
export function parseLoadInput(raw: string, unit: Unit): ParsedLoad {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: 'empty' };

  const isPercent = trimmed.endsWith('%');
  // "75 %" y "75%" son el mismo número: el espacio antes del símbolo es lo
  // normal en un teclado en español.
  const numberPart = (isPercent ? trimmed.slice(0, -1) : trimmed).trim().replace(',', '.');
  const value = Number(numberPart);

  if (numberPart.length === 0 || !Number.isFinite(value)) {
    return { kind: 'invalid', reason: 'Escribe un número, con % si es porcentaje.' };
  }

  if (isPercent) {
    if (value < PERCENT_MIN || value > PERCENT_MAX) {
      return {
        kind: 'invalid',
        reason: `El porcentaje va de ${PERCENT_MIN} a ${PERCENT_MAX}.`,
      };
    }
    return { kind: 'percent', value };
  }

  if (value <= 0) {
    return { kind: 'invalid', reason: 'El peso tiene que ser mayor que cero.' };
  }
  return { kind: 'kg', value: toKg(value, unit) };
}

/** "5" = 5–5, "3-5" = 3–5 (vale guion corto o largo). null = vacío o inválido. */
export function parseRepsRange(raw: string): { lo: number; hi: number } | null {
  const parts = raw.trim().split(/\s*[-–]\s*/);
  if (parts.length > 2) return null;
  const [lo, hi = lo] = parts.map(Number);
  const ok = (n: number | undefined): n is number =>
    n !== undefined && Number.isInteger(n) && n >= 1 && n <= 100;
  return ok(lo) && ok(hi) && hi >= lo ? { lo, hi } : null;
}

export interface Backoff {
  backoffSets: number | null;
  backoffReps: number | null;
  backoffLoadKg: number | null;
  backoffLoadPercent: number | null;
}

export const NO_BACKOFF: Backoff = {
  backoffSets: null,
  backoffReps: null,
  backoffLoadKg: null,
  backoffLoadPercent: null,
};

/**
 * Los tres campos del back-off. Va entero (sets, reps y carga) o vacío, la
 * misma regla que exige el servidor.
 */
export function parseBackoff(
  sets: string,
  reps: string,
  load: string,
  unit: Unit,
): Backoff | { error: string } {
  if ([sets, reps, load].every((t) => t.trim() === '')) return NO_BACKOFF;

  const s = Number(sets.trim());
  const r = Number(reps.trim());
  const l = parseLoadInput(load, unit);
  if (l.kind === 'invalid') return { error: `Back-off: ${l.reason}` };
  if (!Number.isInteger(s) || s < 1 || s > 20 || !Number.isInteger(r) || r < 1 || r > 100
    || l.kind === 'empty') {
    return { error: 'El back-off lleva sets, reps y carga, o nada.' };
  }
  return {
    backoffSets: s,
    backoffReps: r,
    backoffLoadKg: l.kind === 'kg' ? l.value : null,
    backoffLoadPercent: l.kind === 'percent' ? l.value : null,
  };
}

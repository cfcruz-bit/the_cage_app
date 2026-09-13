/**
 * Aritmética compartida del motor.
 *
 * CUIDADO AL PORTAR A PYTHON: Math.round de JavaScript redondea .5 hacia
 * +infinito (half-up), mientras que round() de Python usa banker's rounding
 * (half-to-even): Math.round(2.5) === 3 pero round(2.5) == 2. El port debe
 * usar Decimal con ROUND_HALF_UP, no round(). Los casos golden de
 * golden/cases.json cubren exactamente esta diferencia.
 */

import { EPLEY_DIVISOR } from './policy';

/** Acota v al intervalo [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Redondea half-up a JS. Equivalente a Math.round para valores positivos. */
export function roundHalfUp(v: number): number {
  return Math.round(v);
}

/**
 * Redondea v al múltiplo de `increment` más cercano.
 * Sirve para que una carga siempre sea montable con el material disponible
 * (mancuernas de 2.5 kg, placas de cable de 1.25 kg…).
 *
 * El factor 1e6 corrige el error de coma flotante de 27.5 / 1.25 y similares.
 */
export function roundTo(v: number, increment: number): number {
  if (increment <= 0) throw new RangeError('increment debe ser > 0');
  const rounded = roundHalfUp(v / increment) * increment;
  return Math.round(rounded * 1e6) / 1e6;
}

/**
 * 1RM estimado por Epley extendido con RIR:
 *   e1RM = w · (1 + (reps + rir) / 30)
 * Las reps se suman al RIR porque un set a RIR 2 equivale a uno con 2 reps más.
 */
export function e1rm(weightKg: number, reps: number, rir: number): number {
  return weightKg * (1 + (Number(reps) + Number(rir)) / EPLEY_DIVISOR);
}

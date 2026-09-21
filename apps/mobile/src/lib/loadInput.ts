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

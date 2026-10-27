/**
 * Series de aproximación antes del primer set de un ejercicio con barra.
 *
 * Barra sola y luego el 50, 70 y 85 % del top set, redondeado a 2,5 kg (un
 * disco de 1,25 por lado), que es lo más fino que se puede montar con el juego
 * de discos de `plates.ts`. Las reps bajan a medida que sube el peso: calientan
 * sin cansar.
 */

import { BAR_KG } from './plates';

export interface WarmupSet {
  kg: number;
  reps: number;
}

// ponytail: porcentajes fijos para todos. Si un coach quiere los suyos, esto
// pasa a la prescripción del ejercicio.
const STEPS: [pct: number, reps: number][] = [
  [0.5, 5],
  [0.7, 3],
  [0.85, 1],
];
const ROUND_KG = 2.5;

/** Vacío si el top set no pesa más que la barra: no hay nada que aproximar. */
export function warmupSets(topKg: number): WarmupSet[] {
  if (topKg <= BAR_KG) return [];
  const out: WarmupSet[] = [{ kg: BAR_KG, reps: 10 }];
  for (const [pct, reps] of STEPS) {
    const kg = Math.round((topKg * pct) / ROUND_KG) * ROUND_KG;
    // Con un top ligero dos porcentajes caen en el mismo peso, o en la barra:
    // se queda uno y nunca se repite ni se llega al peso de trabajo.
    if (kg > (out[out.length - 1]?.kg ?? 0) && kg < topKg) out.push({ kg, reps });
  }
  return out;
}

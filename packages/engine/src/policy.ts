/**
 * Política de autorregulación.
 *
 * Todas las constantes que el prototipo tenía sueltas dentro de las fórmulas
 * viven aquí, con nombre. Cambiar cualquier valor de este archivo cambia los
 * entrenamientos de todos los atletas: sube POLICY_VERSION cuando lo hagas y
 * guárdala junto a cada plan generado, para poder leer el histórico sabiendo
 * con qué reglas se produjo.
 */

import { Aggressiveness } from './types';

/**
 * Versión de las reglas. Formato AAAA.MM.
 * Se persiste en session_exercises.policy_version.
 */
export const POLICY_VERSION = '2026.09';

/**
 * Divisor de la fórmula de Epley: 1RM ≈ w · (1 + (reps + rir) / 30).
 * 30 es el valor clásico; bajarlo hace la estimación más optimista.
 */
export const EPLEY_DIVISOR = 30;

/**
 * Multiplicador de los saltos de carga según la agresividad elegida por el
 * atleta. Se aplica sobre el número de "pasos" que el motor decide subir,
 * y el resultado se redondea antes de multiplicar por el incremento.
 */
export const AGGRESSIVENESS_FACTOR: Record<Aggressiveness, number> = {
  [Aggressiveness.Low]: 0.5,
  [Aggressiveness.Medium]: 1,
  [Aggressiveness.High]: 1.5,
};

/** Con dolor articular severo se recorta la carga a este porcentaje. */
export const JOINT_PAIN_LOAD_FACTOR = 0.95;

/** Suelo de hard sets: por mucho que se recorte, nunca se baja de aquí. */
export const MIN_HARD_SETS = 2;

/**
 * Tope de pasos de subida cuando el atleta reporta que el volumen estuvo
 * "Al límite": aunque tuviera holgura de RIR, no se sube más de un escalón.
 */
export const AT_LIMIT_MAX_STEPS = 1;

/** Textos de las explicaciones. Centralizados para no repartir strings por el motor. */
export const REASONS = {
  rirSlack: (lastRir: number, targetRir: number) =>
    `cerraste en RIR ${lastRir} con objetivo ${targetRir}`,
  repCeiling: (repHi: number) => `llegaste al tope de ${repHi} reps`,
  rirOvershoot: 'te pasaste del RIR objetivo, se sostiene la carga',
  jointPain: 'dolor articular alto: se recorta carga y volumen',
  stillSore: 'seguías adolorido: misma carga esta semana',
  noSignal: 'sin señales para mover la carga',
  volumeInsufficient: 'reportaste volumen insuficiente',
  lowPump: 'reportaste pump bajo',
  backOff: (repLo: number) => `back-off: el set previo cayó bajo ${repLo} reps`,
  loadUp: 'subes carga: pasaste el tope del rango',
  fatigueDrop: 'misma carga, −1 rep por fatiga acumulada',
  expectedDrop: 'caída esperada de ~1 rep',
  addedSet: (reason: string) => `set añadido: ${reason}`,
} as const;

/** Separador entre motivos acumulados dentro de un mismo plan. */
export const REASON_SEPARATOR = ' · ';

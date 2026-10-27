/**
 * Técnicas de intensidad del último set: rest-pause, drop set y myo-reps.
 *
 * Son opcionales y las pauta el coach. Aquí vive lo que la app calcula sobre
 * ellas sin preguntar al servidor: los pesos de cada bajada de un drop set y
 * el texto que ve el atleta. Puro y sin React, para poder probarlo en Node.
 */

export type Technique = 'rest_pause' | 'drop_set' | 'myo_reps';

export interface TechniquePlan {
  technique: Technique;
  /** Mini-series (rest-pause, myo-reps) o bajadas (drop set). */
  rounds: number;
  /** Segundos de pausa, % que baja cada vez o reps por mini-serie. */
  amount: number;
}

/** Lo que el coach ve y elige, con los valores con los que arranca cada una. */
export const TECHNIQUES: { value: Technique; label: string; tag: string; defaults: [number, number] }[] = [
  { value: 'rest_pause', label: 'Rest-pause', tag: 'RP', defaults: [2, 15] },
  { value: 'drop_set', label: 'Drop set', tag: 'DROP', defaults: [2, 25] },
  { value: 'myo_reps', label: 'Myo-reps', tag: 'MYO', defaults: [3, 5] },
];

/** Etiquetas de los dos campos de cada técnica, en el orden rondas, cantidad. */
export const TECHNIQUE_FIELDS: Record<Technique, [string, string]> = {
  rest_pause: ['Mini-series', 'Pausa (s)'],
  drop_set: ['Bajadas', 'Baja cada vez (%)'],
  myo_reps: ['Mini-series', 'Reps cada una'],
};

export function techniqueTag(t: Technique): string {
  return TECHNIQUES.find((x) => x.value === t)?.tag ?? '';
}

/**
 * Los pesos de un drop set, empezando por el de trabajo. Cada bajada quita un
 * `pct` % de la anterior y se redondea al incremento del ejercicio, que es lo
 * que se puede montar de verdad en la máquina. Nunca baja de un incremento.
 */
export function dropWeights(startKg: number, rounds: number, pct: number, incrementKg: number): number[] {
  const step = incrementKg > 0 ? incrementKg : 2.5;
  const out = [startKg];
  let w = startKg;
  for (let i = 0; i < rounds; i++) {
    const next = Math.round((w * (1 - pct / 100)) / step) * step;
    w = Math.max(step, Math.round(next * 1000) / 1000);
    out.push(w);
  }
  return out;
}

/** Cuántas partes tiene el set entero: la de trabajo más las rondas. */
export function partCount(plan: TechniquePlan): number {
  return plan.rounds + 1;
}

/** "10" y "4+3" a [10, 4, 3]. Lo que no se lee como número cuenta como 0. */
export function splitParts(reps: string | null, subSets: string | null): number[] {
  const first = Number.parseInt(reps ?? '', 10);
  const rest = (subSets ?? '').split('+').filter((x) => x.trim() !== '');
  return [first, ...rest.map((x) => Number.parseInt(x, 10))].map((n) => (Number.isFinite(n) ? n : 0));
}

/** [10, 4, 3] a lo que se guarda: reps "10" y sub_sets "4+3". */
export function joinParts(parts: number[]): { reps: string; subSets: string | null } {
  return {
    reps: String(parts[0] ?? 0),
    subSets: parts.length > 1 ? parts.slice(1).join('+') : null,
  };
}

/** La técnica de un ejercicio de la sesión, o null si no lleva (o le falta algo). */
export function techniqueOf(ex: {
  technique?: Technique | null;
  techniqueRounds?: number | null;
  techniqueAmount?: number | null;
}): TechniquePlan | null {
  if (ex.technique == null || ex.techniqueRounds == null || ex.techniqueAmount == null) return null;
  return { technique: ex.technique, rounds: ex.techniqueRounds, amount: ex.techniqueAmount };
}

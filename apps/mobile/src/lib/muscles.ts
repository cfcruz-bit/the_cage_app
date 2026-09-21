/**
 * Los grupos musculares, en castellano y en orden de pantalla.
 *
 * El servidor los guarda en inglés y en mayúsculas —`CHEST`, `HAMSTRINGS`—
 * porque son los literales del motor y del catálogo. Traducirlos es
 * presentación, y por eso vive aquí y no en la API.
 *
 * El orden no es alfabético: va de arriba abajo del cuerpo, que es como un
 * coach recorre un plan y como estaba ordenado el prototipo.
 *
 * `BASICOS` va primero y no es un músculo: son los movimientos de competición
 * y sus variantes. Encabeza la lista porque es por donde empieza cualquier
 * sesión de fuerza — el básico del día va antes que el accesorio, siempre.
 */

export const MUSCLE_ORDER = [
  'BASICOS',
  'CHEST',
  'BACK',
  'SHOULDERS',
  'BICEPS',
  'TRICEPS',
  'QUADS',
  'HAMSTRINGS',
  'GLUTES',
  'CALVES',
  'ABS',
] as const;

export type MuscleKey = (typeof MUSCLE_ORDER)[number];

export const MUSCLE_LABEL: Record<string, string> = {
  BASICOS: 'Básicos',
  CHEST: 'Pecho',
  BACK: 'Espalda',
  SHOULDERS: 'Hombros',
  BICEPS: 'Bíceps',
  TRICEPS: 'Tríceps',
  QUADS: 'Cuádriceps',
  HAMSTRINGS: 'Isquios',
  GLUTES: 'Glúteos',
  CALVES: 'Gemelos',
  ABS: 'Abdomen',
};

/** Etiqueta legible. Devuelve la clave cruda si el servidor manda una nueva. */
export function muscleLabel(muscle: string): string {
  return MUSCLE_LABEL[muscle] ?? muscle;
}

/**
 * Agrupa una lista por músculo, en orden de pantalla.
 *
 * Los grupos vacíos no salen, y un músculo que esta app no conozca se pinta al
 * final en vez de desaparecer: un ejercicio invisible es peor que uno mal
 * ordenado.
 */
export function groupByMuscle<T extends { muscle: string }>(
  items: readonly T[],
): { muscle: string; label: string; items: T[] }[] {
  const byMuscle = new Map<string, T[]>();
  for (const item of items) {
    const bucket = byMuscle.get(item.muscle);
    if (bucket === undefined) byMuscle.set(item.muscle, [item]);
    else bucket.push(item);
  }

  const known = MUSCLE_ORDER.filter((m) => byMuscle.has(m));
  const unknown = [...byMuscle.keys()]
    .filter((m) => !MUSCLE_ORDER.includes(m as MuscleKey))
    .sort();

  return [...known, ...unknown].map((muscle) => ({
    muscle,
    label: muscleLabel(muscle),
    items: byMuscle.get(muscle) ?? [],
  }));
}

/**
 * Catálogo de ejercicios para la Fase 1.
 *
 * Provisional: en la Fase 2 lo sirve `GET /exercises` desde Postgres. Aquí vive
 * como constante para que la pantalla de Ejercicios sea real desde el día uno.
 */

import { MuscleGroup } from '@cage/engine';

export interface LibraryEntry {
  id: string;
  name: string;
  muscle: MuscleGroup;
  group: string;
  equipment: string;
  bestKg: number;
}

export const MUSCLE_FILTERS = ['Todos', 'Pecho', 'Espalda', 'Hombros', 'Piernas', 'Brazos'] as const;
export type MuscleFilter = (typeof MUSCLE_FILTERS)[number];

export const LIBRARY: LibraryEntry[] = [
  { id: 'lib-incline-db-press', name: 'Incline Dumbbell Press', muscle: MuscleGroup.Chest, group: 'Pecho', equipment: 'Dumbbell · pecho, deltoide anterior', bestKg: 38 },
  { id: 'lib-machine-chest-press', name: 'Machine Chest Press', muscle: MuscleGroup.Chest, group: 'Pecho', equipment: 'Machine · pecho', bestKg: 96 },
  { id: 'lib-neutral-lat-pulldown', name: 'Neutral Grip Lat Pulldown', muscle: MuscleGroup.Back, group: 'Espalda', equipment: 'Cable · dorsal, bíceps', bestKg: 82 },
  { id: 'lib-seated-cable-row', name: 'Seated Cable Row', muscle: MuscleGroup.Back, group: 'Espalda', equipment: 'Cable · dorsal, trapecio medio', bestKg: 75 },
  { id: 'lib-cuffed-lateral-raise', name: 'Cuffed Lateral Raise', muscle: MuscleGroup.Shoulders, group: 'Hombros', equipment: 'Cable · deltoide lateral', bestKg: 27.5 },
  { id: 'lib-machine-lateral-raise', name: 'Machine Lateral Raise', muscle: MuscleGroup.Shoulders, group: 'Hombros', equipment: 'Machine · deltoide lateral, trapecio', bestKg: 45 },
  { id: 'lib-hack-squat', name: 'Hack Squat', muscle: MuscleGroup.Quads, group: 'Piernas', equipment: 'Machine · cuádriceps, glúteo', bestKg: 140 },
  { id: 'lib-lying-leg-curl', name: 'Lying Leg Curl', muscle: MuscleGroup.Hamstrings, group: 'Piernas', equipment: 'Machine · isquiotibiales', bestKg: 68 },
  { id: 'lib-incline-bench-curl', name: 'Incline Bench Curl', muscle: MuscleGroup.Biceps, group: 'Brazos', equipment: 'Dumbbell · bíceps', bestKg: 18 },
  { id: 'lib-cable-pushdown', name: 'Neutral Grip Cable Pushdown', muscle: MuscleGroup.Triceps, group: 'Brazos', equipment: 'Cable · tríceps', bestKg: 32 },
];

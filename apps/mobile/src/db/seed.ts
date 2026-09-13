/**
 * Siembra la sesión de ejemplo la primera vez que se abre la app.
 *
 * Usa las mismas fixtures que anclan los tests del motor, así que lo que ves en
 * pantalla y lo que verifica `npm test` son exactamente los mismos números.
 * En la Fase 2 esto lo sustituye `GET /sessions/today`.
 */

import { PROTOTYPE_EXERCISES } from '@cage/engine';
import { insertExercise, readSetting, writeSetting } from '.';

const SEED_FLAG = 'seeded_v1';

export async function seedIfEmpty(): Promise<void> {
  if (await readSetting(SEED_FLAG)) return;
  for (const [i, ex] of PROTOTYPE_EXERCISES.entries()) {
    await insertExercise(ex, i);
  }
  await writeSetting(SEED_FLAG, new Date().toISOString());
}

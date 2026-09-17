/**
 * Estado de dominio: qué pasó en el entrenamiento.
 *
 * Todo lo que entra aquí se escribe además en SQLite en la misma acción
 * (write-through), para que cerrar la app no pierda un set. La UI nunca lee de
 * la base directamente: lee de aquí.
 *
 * Perf: los componentes se suscriben con selectores finos (`useSession(s =>
 * s.logs[exId])`), no al store entero. Ese es el arreglo del hallazgo H-03 del
 * prototipo, donde cada tecla recalculaba la app completa.
 */

import { create } from 'zustand';
import {
  Aggressiveness,
  Exercise,
  Feedback,
  SetLogEntry,
} from '@cage/engine';
import {
  LogsByExercise,
  readAggressiveness,
  readExercises,
  readFeedbackDone,
  readLogs,
  readPrescriptions,
  readUnit,
  resetSession,
  saveFeedbackRow,
  savePrescription,
  upsertSetLog,
  writeSetting,
} from '@/db';
import { Prescription, emptyPrescription } from '@/lib/prescription';
import type { Unit } from '@/lib/units';

const EMPTY_ENTRY: SetLogEntry = { weightKg: null, reps: null, done: false };

interface SessionState {
  ready: boolean;
  unit: Unit;
  aggressiveness: Aggressiveness;
  exercises: Exercise[];
  logs: LogsByExercise;
  feedbackDone: Record<string, boolean>;
  /** Lo que manda el coach, por ejercicio. Vacío = todo en automático. */
  prescriptions: Record<string, Prescription>;

  hydrate: () => Promise<void>;
  setUnit: (unit: Unit) => Promise<void>;
  setAggressiveness: (a: Aggressiveness) => Promise<void>;

  /** Edita un campo de un set sin marcarlo como hecho. */
  editSet: (exerciseId: string, index: number, patch: Partial<SetLogEntry>) => Promise<void>;
  /** Marca o desmarca un set, rellenando con lo sugerido si estaba vacío. */
  toggleSet: (
    exerciseId: string,
    index: number,
    suggestedKg: number,
    suggestedReps: number,
  ) => Promise<void>;
  /** Guarda el feedback del ejercicio y lo marca como reportado. */
  saveFeedback: (exerciseId: string, feedback: Feedback) => Promise<void>;
  /** Solo el coach: fija o libera campos de la prescripción. */
  setPrescription: (exerciseId: string, patch: Partial<Prescription>) => Promise<void>;
  /** Borra la sesión en curso. Solo para desarrollo. */
  clearSession: () => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  ready: false,
  unit: 'kg',
  aggressiveness: 'Media',
  exercises: [],
  logs: {},
  feedbackDone: {},
  prescriptions: {},

  hydrate: async () => {
    // Sin siembra: la pantalla de entreno arranca vacia hasta que el coach
    // genere una sesion. Lo que habia antes eran tres ejercicios de ejemplo
    // del prototipo.
    const [exercises, logs, feedbackDone, prescriptions, unit, aggressiveness] =
      await Promise.all([
        readExercises(),
        readLogs(),
        readFeedbackDone(),
        readPrescriptions(),
        readUnit(),
        readAggressiveness(),
      ]);
    set({ exercises, logs, feedbackDone, prescriptions, unit, aggressiveness, ready: true });
  },

  setUnit: async (unit) => {
    set({ unit });
    await writeSetting('unit', unit);
  },

  setAggressiveness: async (aggressiveness) => {
    set({ aggressiveness });
    await writeSetting('aggressiveness', aggressiveness);
  },

  editSet: async (exerciseId, index, patch) => {
    const next = applyPatch(get().logs, exerciseId, index, patch);
    set({ logs: next });
    await upsertSetLog(exerciseId, index, next[exerciseId]![index]!);
  },

  toggleSet: async (exerciseId, index, suggestedKg, suggestedReps) => {
    const current = get().logs[exerciseId]?.[index] ?? EMPTY_ENTRY;
    const patch: Partial<SetLogEntry> = current.done
      ? { done: false }
      : {
          done: true,
          // Al marcar sin haber tecleado nada, se registra lo que el motor sugirió.
          weightKg: current.weightKg ?? suggestedKg,
          reps: current.reps == null || current.reps === '' ? String(suggestedReps) : current.reps,
        };
    const next = applyPatch(get().logs, exerciseId, index, patch);
    set({ logs: next });
    await upsertSetLog(exerciseId, index, next[exerciseId]![index]!);
  },

  saveFeedback: async (exerciseId, feedback) => {
    set({ feedbackDone: { ...get().feedbackDone, [exerciseId]: true } });
    await saveFeedbackRow(exerciseId, feedback);
  },

  setPrescription: async (exerciseId, patch) => {
    const current = get().prescriptions[exerciseId] ?? emptyPrescription(exerciseId);
    const next = { ...current, ...patch };
    set({ prescriptions: { ...get().prescriptions, [exerciseId]: next } });
    await savePrescription(next);
  },

  clearSession: async () => {
    await resetSession();
    set({ logs: {}, feedbackDone: {} });
  },
}));

/**
 * Copia inmutable con el parche aplicado, rellenando huecos si el atleta marca
 * el set 3 sin haber tocado el 2.
 */
function applyPatch(
  logs: LogsByExercise,
  exerciseId: string,
  index: number,
  patch: Partial<SetLogEntry>,
): LogsByExercise {
  const list = (logs[exerciseId] ?? []).slice();
  while (list.length <= index) list.push({ ...EMPTY_ENTRY });
  list[index] = { ...(list[index] ?? EMPTY_ENTRY), ...patch };
  return { ...logs, [exerciseId]: list };
}

/** Selector estable para el log de un ejercicio. */
export function selectLogs(exerciseId: string) {
  return (s: SessionState): SetLogEntry[] => s.logs[exerciseId] ?? [];
}

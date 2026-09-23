/**
 * La sesión de hoy.
 *
 * Sustituye a la sesión local de demostración: lo que se entrena ahora es lo
 * que el coach generó en el servidor.
 *
 * La regla que gobierna todo este archivo: **entrenar nunca espera a la red.**
 * El atleta está en un sótano con el teléfono en el suelo entre serie y serie.
 * Así que cada acción hace tres cosas, en este orden:
 *
 *   1. actualiza la pantalla al instante,
 *   2. escribe en SQLite,
 *   3. encola el envío al servidor.
 *
 * Si hay red, la cola se vacía en segundos y no se nota. Si no la hay, tampoco
 * se nota: se vacía cuando vuelva. Lo único que cambia es el contador de
 * pendientes.
 *
 * El servidor deduplica por `clientId`, así que reintentar es seguro incluso
 * cuando el envío SÍ llegó y lo que se perdió fue la respuesta.
 */

import { create } from 'zustand';
import type { Feedback } from '@cage/engine';

import { ApiError } from '@/api/client';
import { currentSession, openNextSession } from '@/api/endpoints';
import type { NextUpOut, SessionOut, SetLogIn } from '@/api/types';
import {
  cacheSession,
  newClientId,
  readLastCachedSession,
  upsertSetLog,
} from '@/db';
import {
  enqueueComplete,
  enqueueFeedback,
  enqueueSets,
} from '@/sync/queue';
import { useSync } from '@/stores/sync';

/** Lo que el atleta marcó y todavía no confirmó el servidor. */
interface LocalMark {
  done: boolean;
  weightKg: number | null;
  reps: string | null;
  rpe: string | null;
}

interface WorkoutState {
  session: SessionOut | null;
  /** Qué día toca abrir cuando no hay sesión abierta. Lo calcula el servidor. */
  next: NextUpOut | null;
  /** Tiene bloque y ya hizo todos sus días. */
  finished: boolean;
  loading: boolean;
  error: string | null;
  /** true si lo que se ve salió de la caché y no del servidor. */
  stale: boolean;

  /** Marcas locales, por `${sessionExerciseId}:${index}`. */
  marks: Record<string, LocalMark>;
  /** Ejercicios con feedback ya reportado en este dispositivo. */
  feedbackDone: Record<string, boolean>;

  load: (athleteId?: string) => Promise<void>;
  /** El atleta abre su día: el servidor decide cuál. */
  openNext: () => Promise<void>;
  toggleSet: (
    sessionExerciseId: string,
    index: number,
    targetWeightKg: number,
    targetReps: number,
  ) => Promise<void>;
  reportSet: (
    sessionExerciseId: string,
    index: number,
    patch: { weightKg: number | null; reps: string | null; rpe: string | null },
  ) => Promise<void>;
  saveFeedback: (sessionExerciseId: string, feedback: Feedback) => Promise<void>;
  complete: () => Promise<void>;
}

const key = (sessionExerciseId: string, index: number) =>
  `${sessionExerciseId}:${index}`;

export const useWorkout = create<WorkoutState>((set, get) => ({
  session: null,
  next: null,
  finished: false,
  loading: false,
  error: null,
  stale: false,
  marks: {},
  feedbackDone: {},

  load: async (athleteId) => {
    set({ loading: true, error: null });
    try {
      const { session, next, finished } = await currentSession(athleteId);
      if (session !== null) await cacheSession(session.id, session);
      set({ session, next, finished, stale: false, marks: {}, feedbackDone: {} });
    } catch (error) {
      // Sin red se abre lo último que se vio. Perder el entrenamiento por no
      // tener cobertura sería el peor fallo posible de esta app.
      const cached = await readLastCachedSession<SessionOut>();
      set({
        session: cached,
        // Sin red no se sabe qué toca: solo se puede retomar lo ya guardado.
        next: null,
        finished: false,
        stale: cached !== null,
        error:
          cached !== null
            ? null
            : error instanceof ApiError && error.offline
              ? 'Sin conexión y nada guardado todavía.'
              : 'No se pudo cargar la sesión.',
      });
    } finally {
      set({ loading: false });
    }
  },

  openNext: async () => {
    set({ loading: true, error: null });
    try {
      const session = await openNextSession();
      await cacheSession(session.id, session);
      set({ session, next: null, stale: false, marks: {}, feedbackDone: {} });
    } catch (error) {
      set({
        error:
          error instanceof ApiError
            ? error.offline
              ? 'Sin conexión con el servidor.'
              : error.message
            : 'No se pudo abrir tu día.',
      });
    } finally {
      set({ loading: false });
    }
  },

  toggleSet: async (sessionExerciseId, index, targetWeightKg, targetReps) => {
    const id = key(sessionExerciseId, index);
    const current = get().marks[id];
    const done = !(current?.done ?? serverDone(get().session, sessionExerciseId, index));

    // Al marcar sin haber tocado nada se asume que hizo lo pautado. Es lo que
    // pasa el 90% de las veces, y obligar a teclear peso y reps en cada serie
    // haría que nadie use la app entrenando.
    const mark: LocalMark = {
      done,
      weightKg: current?.weightKg ?? targetWeightKg,
      reps: current?.reps ?? String(targetReps),
      rpe: current?.rpe ?? null,
    };

    set({ marks: { ...get().marks, [id]: mark } });
    await persist(sessionExerciseId, index, mark);
  },

  reportSet: async (sessionExerciseId, index, patch) => {
    const id = key(sessionExerciseId, index);
    const current = get().marks[id];

    const mark: LocalMark = {
      // Reportar una desviación implica que la serie se hizo.
      done: true,
      weightKg: patch.weightKg,
      reps: patch.reps,
      rpe: patch.rpe,
    };
    void current;

    set({ marks: { ...get().marks, [id]: mark } });
    await persist(sessionExerciseId, index, mark);
  },

  saveFeedback: async (sessionExerciseId, feedback) => {
    const session = get().session;
    if (session === null) return;

    set({ feedbackDone: { ...get().feedbackDone, [sessionExerciseId]: true } });
    await enqueueFeedback(session.id, { sessionExerciseId, feedback });
    void useSync.getState().sync();
  },

  complete: async () => {
    const session = get().session;
    if (session === null) return;

    await enqueueComplete(session.id);
    void useSync.getState().sync();
  },
}));

/** Escribe la marca en SQLite y la encola. En ese orden. */
async function persist(
  sessionExerciseId: string,
  index: number,
  mark: LocalMark,
): Promise<void> {
  const session = useWorkout.getState().session;
  if (session === null) return;

  // El clientId se genera aquí y viaja al servidor: es lo que hace que
  // reenviar el mismo set no lo duplique.
  const clientId = newClientId();

  await upsertSetLog(sessionExerciseId, index, {
    weightKg: mark.weightKg,
    reps: mark.reps,
    rpe: mark.rpe,
    done: mark.done,
  });

  const payload: SetLogIn = {
    clientId,
    sessionExerciseId,
    index,
    weightKg: mark.weightKg,
    reps: mark.reps,
    rpe: mark.rpe,
    subSets: null,
    done: mark.done,
    loggedAt: new Date().toISOString(),
  };

  await enqueueSets(session.id, [payload]);
  void useSync.getState().sync();
}

/** Lo que el servidor cree que está hecho, antes de las marcas locales. */
function serverDone(
  session: SessionOut | null,
  sessionExerciseId: string,
  index: number,
): boolean {
  if (session === null) return false;
  const exercise = session.exercises.find((e) => e.id === sessionExerciseId);
  return exercise?.sets.find((s) => s.index === index)?.done ?? false;
}

/**
 * Lo que hay que pintar en un set: el servidor, con la marca local encima.
 *
 * La marca local gana siempre. Es lo que acaba de hacer el atleta hace dos
 * segundos; el servidor todavía no se ha enterado, y esperar a que lo haga
 * sería ver la app "deshacer" lo que uno acaba de tocar.
 */
export function resolveSet(
  marks: Record<string, LocalMark>,
  sessionExerciseId: string,
  index: number,
  fromServer: { done: boolean; loggedWeightKg: number | null; loggedReps: string | null },
): { done: boolean; loggedWeightKg: number | null; loggedReps: string | null } {
  const mark = marks[key(sessionExerciseId, index)];
  if (mark === undefined) return fromServer;
  return {
    done: mark.done,
    loggedWeightKg: mark.weightKg,
    loggedReps: mark.reps,
  };
}

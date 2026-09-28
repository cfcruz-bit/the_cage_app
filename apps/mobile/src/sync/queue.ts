/**
 * La cola de sincronización.
 *
 * El problema que resuelve, en una frase: **el atleta entrena en un sótano sin
 * cobertura y no puede perder ni un set.**
 *
 * Cómo funciona:
 *
 * 1. Todo lo que el atleta hace se escribe primero en SQLite y se encola.
 *    La pantalla no espera a la red nunca.
 * 2. Un worker vacía la cola cuando puede. Si falla por red, reintenta con
 *    backoff exponencial. Si falla por un 4xx, descarta: reintentar una
 *    petición mal formada dará igual mil veces.
 * 3. El servidor deduplica por `clientId`. Por eso un reintento es seguro
 *    aunque el primer envío SÍ llegara y lo que se perdiera fuera la respuesta
 *    —el caso que rompe las colas ingenuas.
 *
 * El orden importa: los sets de un ejercicio tienen que llegar antes que su
 * feedback, y el feedback antes que el cierre de la sesión. Por eso se procesa
 * en orden de inserción y una entrada fallida BLOQUEA la cola en vez de
 * saltarse su turno.
 */

import { ApiError } from '@/api/client';
import { completeSession, pushFeedback, pushSets } from '@/api/endpoints';
import { openDb } from '@/db';
import type { FeedbackIn, SetLogIn } from '@/api/types';

export type QueueKind = 'sets' | 'feedback' | 'complete';

interface QueueRow {
  id: number;
  client_id: string;
  kind: QueueKind;
  payload: string;
  attempts: number;
  next_attempt_at: string | null;
}

export interface QueueItem {
  id: number;
  kind: QueueKind;
  attempts: number;
}

/** Tras este número de intentos fallidos se deja de reintentar. */
export const MAX_ATTEMPTS = 8;

/** Cuántas entradas se procesan por pasada. */
const BATCH = 20;

/**
 * Backoff exponencial con techo: 5s, 10s, 20s… hasta 5 minutos.
 *
 * El techo existe porque sin él el intento número 12 esperaría seis horas, y
 * el atleta que recupera cobertura quiere ver sus datos subidos ya.
 */
export function backoffMs(attempts: number): number {
  const base = 5000 * 2 ** Math.max(0, attempts - 1);
  return Math.min(base, 5 * 60 * 1000);
}

// ── Encolar ─────────────────────────────────────────────────────────────────

async function enqueue(
  kind: QueueKind,
  clientId: string,
  payload: unknown,
): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    `INSERT INTO sync_queue (client_id, kind, payload, attempts, created_at, next_attempt_at)
     VALUES (?, ?, ?, 0, ?, ?)`,
    clientId,
    kind,
    JSON.stringify(payload),
    new Date().toISOString(),
    new Date().toISOString(),
  );
}

export async function enqueueSets(
  sessionId: string,
  sets: SetLogIn[],
): Promise<void> {
  if (sets.length === 0) return;
  await enqueue('sets', sessionId, { sessionId, sets });
}

export async function enqueueFeedback(
  sessionId: string,
  body: FeedbackIn,
): Promise<void> {
  await enqueue('feedback', sessionId, { sessionId, body });
}

export async function enqueueComplete(sessionId: string): Promise<void> {
  await enqueue('complete', sessionId, { sessionId });
}

// ── Vaciar ──────────────────────────────────────────────────────────────────

export interface DrainResult {
  sent: number;
  failed: number;
  /** true si se paró por falta de red. La UI lo usa para el indicador. */
  offline: boolean;
  remaining: number;
}

let draining = false;

/**
 * Sube lo que haya pendiente.
 *
 * Reentrante por bandera: si la app llama a esto desde el foco de pantalla y
 * desde un temporizador a la vez, la segunda llamada devuelve sin hacer nada.
 * Dos workers sobre la misma cola duplicarían envíos y desordenarían la
 * secuencia.
 */
export async function drain(): Promise<DrainResult> {
  if (draining) {
    return { sent: 0, failed: 0, offline: false, remaining: await pending() };
  }
  draining = true;

  const result: DrainResult = {
    sent: 0,
    failed: 0,
    offline: false,
    remaining: 0,
  };

  try {
    const db = await openDb();
    const now = new Date().toISOString();

    const rows = await db.getAllAsync<QueueRow>(
      `SELECT * FROM sync_queue
       WHERE next_attempt_at IS NULL OR next_attempt_at <= ?
       ORDER BY id ASC
       LIMIT ?`,
      now,
      BATCH,
    );

    for (const row of rows) {
      try {
        await send(row);
        await db.runAsync('DELETE FROM sync_queue WHERE id = ?', row.id);
        result.sent += 1;
      } catch (error) {
        const attempts = row.attempts + 1;
        const api = error instanceof ApiError ? error : null;

        if (api !== null && !api.retryable) {
          // La petición está mal: reintentarla saldrá igual. Se descarta y se
          // deja constancia para poder investigarlo.
          await db.runAsync('DELETE FROM sync_queue WHERE id = ?', row.id);
          result.failed += 1;
          console.warn(
            `[sync] descartada ${row.kind} #${row.id}: ${api.status} ${api.message}`,
          );
          continue;
        }

        if (attempts >= MAX_ATTEMPTS) {
          await db.runAsync('DELETE FROM sync_queue WHERE id = ?', row.id);
          result.failed += 1;
          console.warn(`[sync] agotados los intentos de ${row.kind} #${row.id}`);
          continue;
        }

        await db.runAsync(
          `UPDATE sync_queue
           SET attempts = ?, next_attempt_at = ?, last_error = ?
           WHERE id = ?`,
          attempts,
          new Date(Date.now() + backoffMs(attempts)).toISOString(),
          api?.message ?? String(error),
          row.id,
        );

        if (api?.offline === true) {
          // Sin red no tiene sentido intentar las siguientes: se para aquí y
          // se conserva el orden de la cola.
          result.offline = true;
          break;
        }
      }
    }
  } finally {
    draining = false;
  }

  result.remaining = await pending();
  return result;
}

async function send(row: QueueRow): Promise<void> {
  const payload = JSON.parse(row.payload) as Record<string, unknown>;

  switch (row.kind) {
    case 'sets': {
      const { sessionId, sets } = payload as unknown as {
        sessionId: string;
        sets: SetLogIn[];
      };
      await pushSets(sessionId, sets);
      return;
    }
    case 'feedback': {
      const { sessionId, body } = payload as unknown as {
        sessionId: string;
        body: FeedbackIn;
      };
      await pushFeedback(sessionId, body);
      return;
    }
    case 'complete': {
      const { sessionId } = payload as unknown as { sessionId: string };
      await completeSession(sessionId);
      return;
    }
  }
}

export async function pending(): Promise<number> {
  const db = await openDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM sync_queue',
  );
  return row?.n ?? 0;
}


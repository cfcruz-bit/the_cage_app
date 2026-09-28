/**
 * Capa de persistencia local (expo-sqlite).
 *
 * SQLite es la fuente de verdad mientras dura la sesión: el atleta está en un
 * sótano sin cobertura y cada set registrado tiene que sobrevivir a que cierre
 * la app. En la Fase 3 esta misma base alimenta la cola de sincronización.
 *
 * El esquema imita el que tendrá Postgres, para que migrar sea traducir y no
 * rediseñar. `set_logs.client_id` es el UUID que genera el teléfono y lo que
 * hará idempotente el POST /sync/sets.
 */

import * as SQLite from 'expo-sqlite';
import { Aggressiveness, SetLogEntry } from '@cage/engine';
import type { Unit } from '@/lib/units';

const DB_NAME = 'cage.db';

let db: SQLite.SQLiteDatabase | null = null;

export async function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync(DB_NAME);
  await migrate(db);
  return db;
}

/**
 * Migraciones por número de versión. Nunca edites una migración ya publicada:
 * añade la siguiente. `user_version` es el contador que trae SQLite.
 */
async function migrate(database: SQLite.SQLiteDatabase): Promise<void> {
  const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  if (current < 1) {
    await database.execAsync(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS exercises (
        id                TEXT PRIMARY KEY,
        position          INTEGER NOT NULL,
        name              TEXT NOT NULL,
        muscle            TEXT NOT NULL,
        equipment         TEXT NOT NULL,
        rep_lo            INTEGER NOT NULL,
        rep_hi            INTEGER NOT NULL,
        target_rir        INTEGER NOT NULL,
        load_increment_kg REAL    NOT NULL,
        last_weight_kg    REAL    NOT NULL,
        last_reps         INTEGER NOT NULL,
        last_rir          INTEGER NOT NULL,
        last_sets         INTEGER NOT NULL,
        last_fb_joint     TEXT    NOT NULL,
        last_fb_soreness  TEXT    NOT NULL,
        last_fb_pump      TEXT    NOT NULL,
        last_fb_volume    TEXT    NOT NULL
      );

      CREATE TABLE IF NOT EXISTS set_logs (
        client_id   TEXT PRIMARY KEY,
        exercise_id TEXT    NOT NULL,
        idx         INTEGER NOT NULL,
        weight_kg   REAL,
        reps        TEXT,
        rpe         TEXT,
        done        INTEGER NOT NULL DEFAULT 0,
        logged_at   TEXT,
        UNIQUE (exercise_id, idx)
      );

      CREATE INDEX IF NOT EXISTS idx_set_logs_exercise
        ON set_logs (exercise_id, idx);

      CREATE TABLE IF NOT EXISTS exercise_feedback (
        exercise_id TEXT PRIMARY KEY,
        joint       TEXT NOT NULL,
        soreness    TEXT NOT NULL,
        pump        TEXT NOT NULL,
        volume      TEXT NOT NULL,
        saved_at    TEXT NOT NULL
      );

      -- Ya existe en la Fase 1 aunque nadie la vacíe todavía: en la Fase 3 es
      -- lo que sostiene el trabajo sin señal.
      CREATE TABLE IF NOT EXISTS sync_queue (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id  TEXT    NOT NULL,
        kind       TEXT    NOT NULL,
        payload    TEXT    NOT NULL,
        attempts   INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL
      );

      PRAGMA user_version = 1;
    `);
  }

  if (current < 2) {
    // Prescripciones del coach. Va en su propia migración porque la 1 ya se
    // ejecutó en los teléfonos que abrieron la app antes de existir esta tabla.
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS prescriptions (
        exercise_id  TEXT PRIMARY KEY,
        sets         INTEGER,
        load_kg      REAL,
        rep_lo       INTEGER,
        rep_hi       INTEGER,
        target_rir   INTEGER,
        rest_seconds INTEGER NOT NULL,
        updated_at   TEXT    NOT NULL
      );

      PRAGMA user_version = 2;
    `);
  }

  if (current < 3) {
    // Backoff de la cola de sincronizacion. `next_attempt_at` es cuando toca
    // volver a intentarlo; mientras sea futuro, el worker se la salta.
    // `last_error` no lo lee nadie: existe para poder investigar por que una
    // entrada lleva seis intentos sin subir.
    await database.execAsync(`
      ALTER TABLE sync_queue ADD COLUMN next_attempt_at TEXT;
      ALTER TABLE sync_queue ADD COLUMN last_error TEXT;

      CREATE INDEX IF NOT EXISTS idx_sync_queue_next
        ON sync_queue (next_attempt_at);

      PRAGMA user_version = 3;
    `);
  }

  if (current < 4) {
    // Fuera los ejercicios de demostracion del prototipo.
    //
    // Hasta ahora la app sembraba tres ejercicios de ejemplo la primera vez
    // que se abria, para que la pantalla de entreno tuviera algo que enseñar
    // antes de que existiera el servidor. Ya existe, y esos datos falsos solo
    // confunden: un atleta no tiene que ver un press de banca que nadie le
    // pauto.
    //
    // Se borra tambien lo que colgaba de ellos. Sin esto, los telefonos que ya
    // abrieron la app se quedarian con los tres ejercicios para siempre,
    // porque quitar la siembra no deshace la siembra ya hecha.
    await database.execAsync(`
      DELETE FROM set_logs;
      DELETE FROM exercise_feedback;
      DELETE FROM prescriptions;
      DELETE FROM exercises;
      DELETE FROM settings WHERE key = 'seeded_v1';

      PRAGMA user_version = 4;
    `);
  }

  if (current < 5) {
    // Cache de la sesion que manda el servidor.
    //
    // Se guarda el JSON entero tal cual llega. Podria normalizarse en tablas,
    // pero no hay nada que consultar por partes: la pantalla necesita la
    // sesion completa o ninguna. Guardar el JSON hace que un cambio en la
    // forma de la respuesta no exija una migracion.
    //
    // Existe por una sola razon: que el atleta abra la app en un sotano sin
    // cobertura y vea lo que le toca entrenar.
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS remote_sessions (
        id         TEXT PRIMARY KEY,
        payload    TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );

      PRAGMA user_version = 5;
    `);
  }
}

/* ── Cache de la sesion del servidor ──────────────────────────────────────── */

export async function cacheSession(id: string, payload: unknown): Promise<void> {
  const database = await openDb();
  await database.runAsync(
    `INSERT INTO remote_sessions (id, payload, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       payload = excluded.payload, fetched_at = excluded.fetched_at`,
    id,
    JSON.stringify(payload),
    new Date().toISOString(),
  );
}

/** La ultima sesion cacheada. Es lo que se abre cuando no hay red. */
export async function readLastCachedSession<T>(): Promise<T | null> {
  const database = await openDb();
  const row = await database.getFirstAsync<{ payload: string }>(
    'SELECT payload FROM remote_sessions ORDER BY fetched_at DESC LIMIT 1',
  );
  return row === null ? null : parse<T>(row.payload);
}

function parse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Una cache corrupta no puede impedir abrir la app: se trata como si no
    // hubiera nada guardado y se pide al servidor.
    return null;
  }
}

/* ── Ajustes ──────────────────────────────────────────────────────────────── */

export async function readSetting(key: string): Promise<string | null> {
  const database = await openDb();
  const row = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export async function writeSetting(key: string, value: string): Promise<void> {
  const database = await openDb();
  await database.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

export async function readUnit(): Promise<Unit> {
  return (await readSetting('unit')) === 'lb' ? 'lb' : 'kg';
}

export async function readAggressiveness(): Promise<Aggressiveness> {
  const raw = await readSetting('aggressiveness');
  return raw === 'Baja' || raw === 'Alta' ? raw : 'Media';
}

/* ── Sets registrados ─────────────────────────────────────────────────────── */

export async function upsertSetLog(
  exerciseId: string,
  index: number,
  entry: SetLogEntry,
): Promise<void> {
  const database = await openDb();
  await database.runAsync(
    `INSERT INTO set_logs (client_id, exercise_id, idx, weight_kg, reps, rpe, done, logged_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(exercise_id, idx) DO UPDATE SET
       weight_kg = excluded.weight_kg,
       reps      = excluded.reps,
       rpe       = excluded.rpe,
       done      = excluded.done,
       logged_at = excluded.logged_at`,
    newClientId(),
    exerciseId,
    index,
    entry.weightKg,
    entry.reps,
    entry.rpe ?? null,
    entry.done ? 1 : 0,
    new Date().toISOString(),
  );
}

/* ── Utilidades ───────────────────────────────────────────────────────────── */

/**
 * UUID v4 sin dependencias. En la Fase 3 este id viaja al servidor y es lo que
 * evita duplicar un set cuando la cola reintenta.
 */
export function newClientId(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[8 + ((Math.random() * 4) | 0)] ?? '8';
    else out += hex[(Math.random() * 16) | 0] ?? '0';
  }
  return out;
}

/** Solo para desarrollo: vacía la sesión y vuelve a sembrar. */
export async function resetSession(): Promise<void> {
  const database = await openDb();
  await database.execAsync(
    'DELETE FROM set_logs; DELETE FROM exercise_feedback;',
  );
}

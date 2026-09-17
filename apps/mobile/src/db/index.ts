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
import {
  Aggressiveness,
  Exercise,
  Feedback,
  JointPain,
  MuscleGroup,
  Pump,
  SetLogEntry,
  Soreness,
  WorkloadFeel,
} from '@cage/engine';
import type { Unit } from '@/lib/units';
import { DEFAULT_REST_SECONDS, Prescription } from '@/lib/prescription';

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

export async function readCachedSession<T>(id: string): Promise<T | null> {
  const database = await openDb();
  const row = await database.getFirstAsync<{ payload: string }>(
    'SELECT payload FROM remote_sessions WHERE id = ?',
    id,
  );
  return row === null ? null : parse<T>(row.payload);
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

/* ── Ejercicios ───────────────────────────────────────────────────────────── */

interface ExerciseRow {
  id: string;
  position: number;
  name: string;
  muscle: string;
  equipment: string;
  rep_lo: number;
  rep_hi: number;
  target_rir: number;
  load_increment_kg: number;
  last_weight_kg: number;
  last_reps: number;
  last_rir: number;
  last_sets: number;
  last_fb_joint: string;
  last_fb_soreness: string;
  last_fb_pump: string;
  last_fb_volume: string;
}

function rowToExercise(r: ExerciseRow): Exercise {
  return {
    id: r.id,
    name: r.name,
    muscle: r.muscle as MuscleGroup,
    equipment: r.equipment,
    repLo: r.rep_lo,
    repHi: r.rep_hi,
    targetRir: r.target_rir,
    loadIncrementKg: r.load_increment_kg,
    last: {
      weightKg: r.last_weight_kg,
      reps: r.last_reps,
      rir: r.last_rir,
      sets: r.last_sets,
      feedback: {
        joint: r.last_fb_joint as JointPain,
        soreness: r.last_fb_soreness as Soreness,
        pump: r.last_fb_pump as Pump,
        volume: r.last_fb_volume as WorkloadFeel,
      },
    },
  };
}

export async function readExercises(): Promise<Exercise[]> {
  const database = await openDb();
  const rows = await database.getAllAsync<ExerciseRow>(
    'SELECT * FROM exercises ORDER BY position ASC',
  );
  return rows.map(rowToExercise);
}

export async function insertExercise(ex: Exercise, position: number): Promise<void> {
  const database = await openDb();
  await database.runAsync(
    `INSERT OR REPLACE INTO exercises
      (id, position, name, muscle, equipment, rep_lo, rep_hi, target_rir, load_increment_kg,
       last_weight_kg, last_reps, last_rir, last_sets,
       last_fb_joint, last_fb_soreness, last_fb_pump, last_fb_volume)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ex.id,
    position,
    ex.name,
    ex.muscle,
    ex.equipment,
    ex.repLo,
    ex.repHi,
    ex.targetRir,
    ex.loadIncrementKg,
    ex.last.weightKg,
    ex.last.reps,
    ex.last.rir,
    ex.last.sets,
    ex.last.feedback.joint,
    ex.last.feedback.soreness,
    ex.last.feedback.pump,
    ex.last.feedback.volume,
  );
}

/* ── Prescripciones del coach ─────────────────────────────────────────────── */

interface PrescriptionRow {
  exercise_id: string;
  sets: number | null;
  load_kg: number | null;
  rep_lo: number | null;
  rep_hi: number | null;
  target_rir: number | null;
  rest_seconds: number;
}

export async function readPrescriptions(): Promise<Record<string, Prescription>> {
  const database = await openDb();
  const rows = await database.getAllAsync<PrescriptionRow>('SELECT * FROM prescriptions');
  return Object.fromEntries(
    rows.map((r) => [
      r.exercise_id,
      {
        exerciseId: r.exercise_id,
        sets: r.sets,
        loadKg: r.load_kg,
        repLo: r.rep_lo,
        repHi: r.rep_hi,
        targetRir: r.target_rir,
        restSeconds: r.rest_seconds ?? DEFAULT_REST_SECONDS,
      },
    ]),
  );
}

export async function savePrescription(p: Prescription): Promise<void> {
  const database = await openDb();
  await database.runAsync(
    `INSERT INTO prescriptions
       (exercise_id, sets, load_kg, rep_lo, rep_hi, target_rir, rest_seconds, updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(exercise_id) DO UPDATE SET
       sets = excluded.sets, load_kg = excluded.load_kg,
       rep_lo = excluded.rep_lo, rep_hi = excluded.rep_hi,
       target_rir = excluded.target_rir, rest_seconds = excluded.rest_seconds,
       updated_at = excluded.updated_at`,
    p.exerciseId,
    p.sets,
    p.loadKg,
    p.repLo,
    p.repHi,
    p.targetRir,
    p.restSeconds,
    new Date().toISOString(),
  );
}

/* ── Sets registrados ─────────────────────────────────────────────────────── */

interface SetLogRow {
  client_id: string;
  exercise_id: string;
  idx: number;
  weight_kg: number | null;
  reps: string | null;
  rpe: string | null;
  done: number;
}

export type LogsByExercise = Record<string, SetLogEntry[]>;

export async function readLogs(): Promise<LogsByExercise> {
  const database = await openDb();
  const rows = await database.getAllAsync<SetLogRow>(
    'SELECT * FROM set_logs ORDER BY exercise_id, idx ASC',
  );

  const out: LogsByExercise = {};
  for (const r of rows) {
    const list = (out[r.exercise_id] ??= []);
    while (list.length <= r.idx) {
      list.push({ weightKg: null, reps: null, done: false });
    }
    list[r.idx] = {
      weightKg: r.weight_kg,
      reps: r.reps,
      rpe: r.rpe,
      done: r.done === 1,
    };
  }
  return out;
}

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

/* ── Feedback ─────────────────────────────────────────────────────────────── */

export async function readFeedbackDone(): Promise<Record<string, boolean>> {
  const database = await openDb();
  const rows = await database.getAllAsync<{ exercise_id: string }>(
    'SELECT exercise_id FROM exercise_feedback',
  );
  return Object.fromEntries(rows.map((r) => [r.exercise_id, true]));
}

export async function saveFeedbackRow(exerciseId: string, fb: Feedback): Promise<void> {
  const database = await openDb();
  await database.runAsync(
    `INSERT INTO exercise_feedback (exercise_id, joint, soreness, pump, volume, saved_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(exercise_id) DO UPDATE SET
       joint = excluded.joint, soreness = excluded.soreness,
       pump = excluded.pump, volume = excluded.volume, saved_at = excluded.saved_at`,
    exerciseId,
    fb.joint,
    fb.soreness,
    fb.pump,
    fb.volume,
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

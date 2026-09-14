/**
 * Las llamadas concretas a la API, tipadas.
 *
 * Una función por endpoint, sin lógica. Así las pantallas no construyen rutas
 * a mano y un cambio de ruta se arregla en un solo sitio.
 */

import { request } from '@/api/client';
import { clearTokens, getTokens, saveTokens, saveUser } from '@/api/session';
import type {
  AthleteCardOut,
  AthleteSummaryOut,
  CoachOverviewOut,
  ExerciseCatalogOut,
  FeedbackIn,
  MesocycleOut,
  PrescriptionOut,
  Role,
  SessionOut,
  SetLogIn,
  SyncResult,
  TokenPair,
  UserOut,
} from '@/api/types';

// ── Autenticación ───────────────────────────────────────────────────────────

export async function register(
  email: string,
  password: string,
  displayName: string,
  role: Role,
): Promise<UserOut> {
  return request<UserOut>('/auth/register', {
    method: 'POST',
    body: { email, password, displayName, role },
    auth: false,
  });
}

export async function login(email: string, password: string): Promise<UserOut> {
  const pair = await request<TokenPair>('/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
  await saveTokens(pair);

  const user = await request<UserOut>('/auth/me');
  await saveUser(user);
  return user;
}

export async function logout(): Promise<void> {
  const tokens = await getTokens();
  if (tokens !== null) {
    try {
      await request<void>('/auth/logout', {
        method: 'POST',
        body: { refreshToken: tokens.refreshToken },
      });
    } catch {
      // Sin cobertura no se puede revocar en el servidor. Se cierra igual en
      // local: lo contrario sería dejar al usuario atrapado en su cuenta.
    }
  }
  await clearTokens();
}

export async function me(): Promise<UserOut> {
  return request<UserOut>('/auth/me');
}

/**
 * Cambia la contraseña. Es lo ÚNICO que la API permite con una provisional.
 *
 * El servidor revoca las demás sesiones al hacerlo, así que después hay que
 * volver a entrar: si alguien se hizo con la provisional, cambiarla tiene que
 * echarlo, no convivir con él.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<UserOut> {
  return request<UserOut>('/auth/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });
}

// ── Catálogo ────────────────────────────────────────────────────────────────

export async function listExercises(): Promise<ExerciseCatalogOut[]> {
  return request<ExerciseCatalogOut[]>('/exercises');
}

// ── Mesociclos ──────────────────────────────────────────────────────────────

export async function getMesocycle(id: string): Promise<MesocycleOut> {
  return request<MesocycleOut>(`/mesocycles/${id}`);
}

export async function setPrescription(
  mesocycleId: string,
  exerciseId: string,
  body: {
    sets: number | null;
    loadKg: number | null;
    repLo: number | null;
    repHi: number | null;
    targetRir: number | null;
    restSeconds: number;
  },
): Promise<PrescriptionOut> {
  return request<PrescriptionOut>(
    `/mesocycles/${mesocycleId}/exercises/${exerciseId}/prescription`,
    { method: 'PUT', body },
  );
}

// ── Sesiones ────────────────────────────────────────────────────────────────

export async function createSession(
  mesocycleId: string,
  weekNumber: number,
  dayLabel: string,
): Promise<SessionOut> {
  return request<SessionOut>(`/mesocycles/${mesocycleId}/sessions`, {
    method: 'POST',
    body: { weekNumber, dayLabel },
  });
}

export async function getSession(id: string): Promise<SessionOut> {
  return request<SessionOut>(`/sessions/${id}`);
}

export async function pushSets(
  sessionId: string,
  sets: SetLogIn[],
): Promise<SyncResult> {
  return request<SyncResult>(`/sessions/${sessionId}/sets`, {
    method: 'POST',
    body: { sets },
  });
}

export async function pushFeedback(
  sessionId: string,
  body: FeedbackIn,
): Promise<void> {
  return request<void>(`/sessions/${sessionId}/feedback`, {
    method: 'POST',
    body,
  });
}

export async function completeSession(sessionId: string): Promise<SessionOut> {
  return request<SessionOut>(`/sessions/${sessionId}/complete`, {
    method: 'POST',
  });
}

// ── Panel del coach ─────────────────────────────────────────────────────────

export async function listAthletes(): Promise<UserOut[]> {
  return request<UserOut[]>('/coach/athletes');
}

export async function linkAthlete(email: string): Promise<UserOut> {
  return request<UserOut>('/coach/athletes', {
    method: 'POST',
    body: { email },
  });
}

export async function coachOverview(): Promise<CoachOverviewOut> {
  return request<CoachOverviewOut>('/coach/overview');
}

export async function athleteCards(): Promise<AthleteCardOut[]> {
  return request<AthleteCardOut[]>('/coach/athletes/summaries');
}

export async function athleteSummary(
  athleteId: string,
): Promise<AthleteSummaryOut> {
  return request<AthleteSummaryOut>(`/coach/athletes/${athleteId}/summary`);
}

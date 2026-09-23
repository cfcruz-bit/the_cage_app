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
  CurrentSessionOut,
  ExerciseCatalogOut,
  FeedbackIn,
  MesocycleIn,
  MesocycleOut,
  MesocycleSummaryOut,
  OneRepMaxIn,
  OneRepMaxOut,
  PlanGridOut,
  PrescriptionIn,
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

export async function listMesocycles(
  athleteId?: string,
): Promise<MesocycleSummaryOut[]> {
  const query = athleteId === undefined ? '' : `?athleteId=${athleteId}`;
  return request<MesocycleSummaryOut[]>(`/mesocycles${query}`);
}

export async function createMesocycle(body: MesocycleIn): Promise<MesocycleOut> {
  return request<MesocycleOut>('/mesocycles', { method: 'POST', body });
}

export async function planGrid(mesocycleId: string): Promise<PlanGridOut> {
  return request<PlanGridOut>(`/mesocycles/${mesocycleId}/plan`);
}

/**
 * Fija (o libera) lo que manda el coach.
 *
 * Sin `weekNumber` toca la prescripción base, que vale para todo el bloque.
 * Con `weekNumber` toca solo esa semana. Un campo en null devuelve ese aspecto
 * al motor.
 */
export async function setPrescription(
  mesocycleId: string,
  exerciseId: string,
  body: PrescriptionIn,
): Promise<PrescriptionOut> {
  return request<PrescriptionOut>(
    `/mesocycles/${mesocycleId}/exercises/${exerciseId}/prescription`,
    { method: 'PUT', body },
  );
}

// ── Sesiones ────────────────────────────────────────────────────────────────

/**
 * El coach genera la sesión de un día de su atleta. El título sale solo: el
 * nombre del día si lo tiene, "Día N" si no.
 */
export async function createSession(
  mesocycleId: string,
  weekNumber: number,
  dayNumber: number,
): Promise<SessionOut> {
  return request<SessionOut>(`/mesocycles/${mesocycleId}/sessions`, {
    method: 'POST',
    body: { weekNumber, dayNumber },
  });
}

/**
 * El atleta abre SU día. No manda semana ni día: los calcula el servidor, para
 * que el atleta no elija qué entrenar. Si ya tiene una abierta, devuelve esa.
 */
export async function openNextSession(): Promise<SessionOut> {
  return request<SessionOut>('/sessions/next', { method: 'POST' });
}

/**
 * La sesión abierta del atleta y, si no hay ninguna, qué día le toca abrir.
 *
 * `session: null` y no un error: "hoy no hay nada abierto" es una respuesta
 * normal del producto.
 */
export async function currentSession(
  athleteId?: string,
): Promise<CurrentSessionOut> {
  const query = athleteId === undefined ? '' : `?athleteId=${athleteId}`;
  return request<CurrentSessionOut>(`/sessions/current${query}`);
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

// ── Marcas de fuerza (1RM) ──────────────────────────────────────────────────

/** Vigentes por defecto; con `onlyCurrent: false` sale el historial completo. */
export async function listRecords(
  athleteId: string,
  onlyCurrent = true,
): Promise<OneRepMaxOut[]> {
  const query = onlyCurrent ? '' : '?onlyCurrent=false';
  return request<OneRepMaxOut[]>(`/athletes/${athleteId}/records${query}`);
}

export async function createRecord(
  athleteId: string,
  body: OneRepMaxIn,
): Promise<OneRepMaxOut> {
  return request<OneRepMaxOut>(`/athletes/${athleteId}/records`, {
    method: 'POST',
    body,
  });
}

export async function deleteRecord(athleteId: string, recordId: string): Promise<void> {
  return request<void>(`/athletes/${athleteId}/records/${recordId}`, {
    method: 'DELETE',
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

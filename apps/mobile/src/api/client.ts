/**
 * Cliente HTTP contra la API.
 *
 * Tres cosas que hace y conviene entender antes de tocarlo:
 *
 * 1. **Refresca el token una sola vez.** Ante un 401 intenta renovar y repite
 *    la petición. Si el reintento vuelve a dar 401, se rinde y cierra sesión.
 *    Sin ese tope, un refresh token caducado provoca un bucle infinito de
 *    peticiones desde el teléfono del atleta.
 *
 * 2. **Una sola renovación a la vez.** Si tres peticiones fallan con 401
 *    simultáneamente, las tres esperan al MISMO refresco. El servidor rota y
 *    revoca el refresh token al usarlo, así que tres renovaciones en paralelo
 *    se invalidarían entre sí y cerrarían la sesión sin motivo.
 *
 * 3. **Distingue fallo de red de fallo del servidor.** Estar sin cobertura no
 *    es un error: es el estado normal en un sótano. `ApiError.offline` es lo
 *    que la cola de sincronización mira para decidir si reintenta o descarta.
 */

import Constants from 'expo-constants';

import { clearTokens, getTokens, saveTokens } from '@/api/session';
import type { TokenPair } from '@/api/types';

/** Puerto donde escucha uvicorn. */
const API_PORT = 8000;

/**
 * Dónde está el servidor, averiguado solo.
 *
 * En desarrollo NO hace falta configurar nada. El razonamiento: el teléfono
 * acaba de descargar este código de Metro, que corre en tu PC, así que ya sabe
 * la IP de tu PC — está en `hostUri`, con la forma "192.168.0.15:8081". Se le
 * cambia el puerto por el de la API y listo.
 *
 * Eso elimina el paso de buscar la IPv4 del adaptador Wi-Fi a mano, que además
 * hay que repetir cada vez que el router reparte una dirección distinta.
 *
 * En una build de producción no hay Metro del que deducir nada, así que manda
 * `extra.apiUrl` de `app.json` — el servidor desplegado en Fly.
 *
 * El orden importa y es a propósito: **en desarrollo gana la autodetección**,
 * aunque `apiUrl` tenga valor. Si mandara siempre, cada vez que arrancaras
 * Metro para probar un cambio estarías escribiendo en la base de producción,
 * con las membresías y las sesiones de atletas reales dentro. Es un accidente
 * que solo se comete una vez, pero no tiene deshacer.
 *
 * Para probar a propósito contra el servidor real desde Metro, pon
 * `extra.forceApiUrl: true` en `app.json` — y acuérdate de quitarlo.
 */
function resolveApiUrl(): string {
  const crudo = Constants.expoConfig?.extra?.apiUrl;
  const configured =
    typeof crudo === 'string' ? crudo.trim().replace(/\/+$/, '') : '';
  const forzado = Constants.expoConfig?.extra?.forceApiUrl === true;

  if (configured.length > 0 && (!__DEV__ || forzado)) {
    return configured;
  }

  const hostUri =
    Constants.expoConfig?.hostUri ??
    // En algunos modos de arranque hostUri no está, pero sí la URL del bundle.
    (Constants.linkingUri as string | undefined);

  const host = hostUri?.split('://').pop()?.split('/')[0]?.split(':')[0];

  if (host !== undefined && host.length > 0) {
    return `http://${host}:${API_PORT}`;
  }

  // Último recurso. Solo sirve en el emulador o en web, donde el teléfono y el
  // servidor son la misma máquina.
  return `http://localhost:${API_PORT}`;
}

export const API_URL = resolveApiUrl();

// Se imprime en la terminal de Metro al arrancar. Es la forma más rápida de
// distinguir "el servidor no responde" de "la app está mirando a la dirección
// equivocada", que producen el mismo mensaje en pantalla y se arreglan distinto.
if (__DEV__) {
  const remoto = API_URL.startsWith('https://');
  console.log(
    `[cage] API en ${API_URL}${remoto ? '  ← PRODUCCIÓN, cuidado con lo que escribes' : ''}`,
  );
}

const PREFIX = '/api/v1';

/** Tiempo máximo por petición. Sin esto, una red a medias cuelga la pantalla. */
const TIMEOUT_MS = 15000;

export class ApiError extends Error {
  readonly status: number;
  /** true si no se llegó a hablar con el servidor (sin red, timeout, DNS). */
  readonly offline: boolean;

  constructor(message: string, status: number, offline = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.offline = offline;
  }

  /**
   * Acceso vencido: le toca pagar.
   *
   * 402 Payment Required no se usa para nada más en esta API, así que la app
   * puede tratarlo como un caso propio sin mirar el cuerpo de la respuesta.
   */
  get paymentRequired(): boolean {
    return this.status === 402;
  }

  /** ¿Tiene sentido reintentar esto más tarde? */
  get retryable(): boolean {
    // 5xx: el servidor tuvo un mal momento. 429: nos pidió que bajáramos el
    // ritmo. 4xx del resto: la petición está mal y reintentarla saldrá igual.
    return this.offline || this.status >= 500 || this.status === 429;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RequestOptions {
  method?: Method;
  body?: unknown;
  /** false para login y registro, que todavía no tienen token. */
  auth?: boolean;
  signal?: AbortSignal;
}

/** Renovación en curso, compartida por todas las peticiones que la esperan. */
let refreshing: Promise<TokenPair | null> | null = null;

async function refreshTokens(): Promise<TokenPair | null> {
  const current = await getTokens();
  if (current === null) return null;

  try {
    const pair = await rawRequest<TokenPair>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: current.refreshToken },
      auth: false,
    });
    await saveTokens(pair);
    return pair;
  } catch (error) {
    // Un fallo de red al refrescar NO es motivo para cerrar sesión: el token
    // puede seguir siendo válido cuando vuelva la cobertura.
    if (error instanceof ApiError && !error.offline) {
      await clearTokens();
    }
    return null;
  }
}

async function ensureRefreshed(): Promise<TokenPair | null> {
  refreshing ??= refreshTokens().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function rawRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (auth) {
    const tokens = await getTokens();
    if (tokens !== null) {
      headers.Authorization = `Bearer ${tokens.accessToken}`;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${PREFIX}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // fetch solo lanza cuando no se llegó a hablar con el servidor.
    throw new ApiError('Sin conexión con el servidor', 0, true);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload: unknown = text.length > 0 ? safeParse(text) : null;

  if (!response.ok) {
    throw new ApiError(detailOf(payload) ?? response.statusText, response.status);
  }

  return payload as T;
}

/** Petición normal: con token y con un reintento tras refrescar. */
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  try {
    return await rawRequest<T>(path, options);
  } catch (error) {
    const is401 = error instanceof ApiError && error.status === 401;
    if (!is401 || options.auth === false) throw error;

    const renewed = await ensureRefreshed();
    if (renewed === null) throw error;

    // Un único reintento. Si vuelve a dar 401, se propaga.
    return rawRequest<T>(path, options);
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Saca el mensaje de un error de FastAPI.
 *
 * `detail` puede ser una cadena (nuestros HTTPException) o un array de errores
 * de validación de Pydantic. Los dos casos son reales y hay que cubrirlos.
 */
function detailOf(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  const detail = (payload as { detail?: unknown }).detail;

  if (typeof detail === 'string') return detail;

  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: unknown } | undefined;
    if (first && typeof first.msg === 'string') return first.msg;
  }
  return null;
}

/**
 * Dónde viven los tokens en el teléfono.
 *
 * En **SecureStore**, no en SQLite ni en AsyncStorage. La diferencia importa:
 * SecureStore usa el Keychain en iOS y el Keystore en Android, así que el
 * refresh token —que dura un mes— queda cifrado por el sistema operativo. La
 * base de datos de la app es un archivo normal y en un teléfono con root se
 * lee sin esfuerzo.
 *
 * Los tokens se guardan en memoria además de en SecureStore porque cada
 * lectura del Keychain cuesta milisegundos y el cliente HTTP los pide en
 * CADA petición.
 */

import * as SecureStore from 'expo-secure-store';

import type { Role, TokenPair, UserOut } from '@/api/types';

const TOKENS_KEY = 'cage.tokens';
const USER_KEY = 'cage.user';

let cachedTokens: TokenPair | null | undefined;
let cachedUser: UserOut | null | undefined;

export async function getTokens(): Promise<TokenPair | null> {
  if (cachedTokens !== undefined) return cachedTokens;

  const raw = await SecureStore.getItemAsync(TOKENS_KEY);
  cachedTokens = raw === null ? null : (safeParse<TokenPair>(raw) ?? null);
  return cachedTokens;
}

export async function saveTokens(tokens: TokenPair): Promise<void> {
  cachedTokens = tokens;
  await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens));
}

export async function getUser(): Promise<UserOut | null> {
  if (cachedUser !== undefined) return cachedUser;

  const raw = await SecureStore.getItemAsync(USER_KEY);
  cachedUser = raw === null ? null : (safeParse<UserOut>(raw) ?? null);
  return cachedUser;
}

export async function saveUser(user: UserOut): Promise<void> {
  cachedUser = user;
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}

/**
 * Cierra la sesión local.
 *
 * NO borra la base de datos: los sets que el atleta registró sin cobertura
 * siguen en la cola y tienen que sobrevivir a un cierre de sesión. Lo que se
 * pierde aquí es la identidad, no el trabajo.
 */
export async function clearTokens(): Promise<void> {
  cachedTokens = null;
  cachedUser = null;
  await SecureStore.deleteItemAsync(TOKENS_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}

export async function currentRole(): Promise<Role | null> {
  return (await getUser())?.role ?? null;
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Un valor corrupto en el Keychain no debe impedir abrir la app: se trata
    // como "no hay sesión" y el usuario vuelve a entrar.
    return null;
  }
}

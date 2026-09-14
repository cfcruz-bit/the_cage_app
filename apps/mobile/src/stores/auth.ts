/**
 * Quién ha entrado.
 *
 * Sustituye a la elección de rol local: ahora el rol lo dice el servidor y esta
 * app solo lo refleja. La distinción importa porque un rol elegido en el
 * teléfono no es una credencial —cualquiera tocaría "COACH"—, mientras que el
 * del servidor viene de la tabla `users` y lo respaldan los permisos de la API.
 *
 * La sesión se restaura al arrancar desde SecureStore, sin pedir red: el atleta
 * tiene que poder abrir la app y entrenar en un sótano sin cobertura.
 */

import { create } from 'zustand';

import { ApiError } from '@/api/client';
import { login as loginRequest, logout as logoutRequest, me } from '@/api/endpoints';
import { getUser, saveUser } from '@/api/session';
import type { Role, UserOut } from '@/api/types';

interface AuthState {
  /** undefined = todavía no se ha mirado. null = no hay sesión. */
  user: UserOut | null | undefined;
  /** Mensaje del último intento fallido, para pintarlo en el formulario. */
  error: string | null;
  busy: boolean;

  restore: () => Promise<void>;
  signIn: (email: string, password: string, expected: Role) => Promise<UserOut | null>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

/** El rol de la cuenta no coincide con la tarjeta que se tocó. */
export const ROLE_MISMATCH =
  'Esa cuenta no tiene ese rol. Entra por la tarjeta que te corresponde.';

export const useAuth = create<AuthState>((set) => ({
  user: undefined,
  error: null,
  busy: false,

  restore: async () => {
    // Solo lectura local. Si el token está caducado, la primera petición real
    // lo refrescará; no tiene sentido bloquear el arranque en la red.
    set({ user: await getUser() });
  },

  signIn: async (email, password, expected) => {
    set({ busy: true, error: null });
    try {
      const user = await loginRequest(email.trim(), password);

      if (user.role !== expected) {
        // Se cierra la sesión recién abierta: entró con credenciales válidas,
        // pero no por la puerta que le corresponde.
        await logoutRequest();
        set({ user: null, error: ROLE_MISMATCH });
        return null;
      }

      set({ user });
      return user;
    } catch (error) {
      set({ error: messageOf(error) });
      return null;
    } finally {
      set({ busy: false });
    }
  },

  signOut: async () => {
    await logoutRequest();
    set({ user: null, error: null });
  },

  clearError: () => set({ error: null }),
}));

/** Refresca el perfil desde el servidor cuando hay red. Silencioso si no. */
export async function refreshProfile(): Promise<void> {
  try {
    const user = await me();
    await saveUser(user);
    useAuth.setState({ user });
  } catch {
    // Sin cobertura se sigue con el perfil guardado. No es un error.
  }
}

/**
 * Un 402 en cualquier pantalla significa que el acceso venció mientras la app
 * estaba abierta. En vez de dejar el error en esa pantalla, se refresca el
 * perfil: el layout raíz verá el estado nuevo y mostrará la pantalla de
 * renovación, que es lo único que tiene sentido enseñarle.
 */
export function handlePaymentRequired(error: unknown): boolean {
  if (error instanceof ApiError && error.paymentRequired) {
    void refreshProfile();
    return true;
  }
  return false;
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.offline) {
      return 'No se pudo contactar con el servidor. Revisa tu conexión.';
    }
    if (error.status === 401) return 'Email o contraseña incorrectos.';
    return error.message;
  }
  return 'Algo salió mal. Inténtalo de nuevo.';
}

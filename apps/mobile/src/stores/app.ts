/**
 * Estado de aplicación: quién entró y en qué rol.
 *
 * Separado del store de sesión y del de UI. Desde la Fase 3 el rol NO se elige
 * aquí: lo rellena `adopt()` con lo que dice la cuenta autenticada. Este store
 * solo guarda qué pinta la interfaz.
 */

import { create } from 'zustand';

export type Role = 'athlete' | 'coach';

interface AppState {
  /** null = pantalla de selección de rol. */
  role: Role | null;
  /** Etiqueta de la transición a pantalla completa ("ATLETA" / "COACH"). */
  entering: string | null;

  enter: (role: Role) => void;
  /** Adopta el rol de la cuenta autenticada. null = no hay sesión. */
  adopt: (role: Role | null) => void;
  logout: () => void;
  clearEntering: () => void;
}

export const ROLE_LABEL: Record<Role, string> = {
  athlete: 'Atleta',
  coach: 'Coach',
};

export const useApp = create<AppState>((set) => ({
  role: null,
  entering: null,

  enter: (role) => set({ entering: ROLE_LABEL[role].toUpperCase(), role }),
  adopt: (role) => set({ role }),
  clearEntering: () => set({ entering: null }),
  logout: () => set({ role: null, entering: null }),
}));

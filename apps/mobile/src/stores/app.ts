/**
 * Estado de aplicación: quién entró y en qué rol.
 *
 * Separado del store de sesión y del de UI. En la Fase 2 el rol deja de
 * elegirse aquí y pasa a venir de `GET /me`, pero la forma del store no
 * cambia: solo cambia quién lo rellena.
 */

import { create } from 'zustand';

export type Role = 'athlete' | 'coach';

interface AppState {
  /** null = pantalla de selección de rol. */
  role: Role | null;
  /** Etiqueta de la transición a pantalla completa ("ATLETA" / "COACH"). */
  entering: string | null;

  enter: (role: Role) => void;
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
  clearEntering: () => set({ entering: null }),
  logout: () => set({ role: null, entering: null }),
}));

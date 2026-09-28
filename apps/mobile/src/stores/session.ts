/**
 * Preferencias del usuario (unidad y agresividad), con write-through a SQLite.
 */

import { create } from 'zustand';
import { Aggressiveness } from '@cage/engine';
import { readAggressiveness, readUnit, resetSession, writeSetting } from '@/db';
import type { Unit } from '@/lib/units';

interface SessionState {
  ready: boolean;
  unit: Unit;
  aggressiveness: Aggressiveness;

  hydrate: () => Promise<void>;
  setUnit: (unit: Unit) => Promise<void>;
  setAggressiveness: (a: Aggressiveness) => Promise<void>;
  /** Borra la sesión en curso. Solo para desarrollo. */
  clearSession: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  ready: false,
  unit: 'kg',
  aggressiveness: 'Media',

  hydrate: async () => {
    const [unit, aggressiveness] = await Promise.all([readUnit(), readAggressiveness()]);
    set({ unit, aggressiveness, ready: true });
  },

  setUnit: async (unit) => {
    set({ unit });
    await writeSetting('unit', unit);
  },

  setAggressiveness: async (aggressiveness) => {
    set({ aggressiveness });
    await writeSetting('aggressiveness', aggressiveness);
  },

  clearSession: async () => {
    await resetSession();
  },
}));

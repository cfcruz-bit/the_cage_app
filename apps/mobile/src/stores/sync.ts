/**
 * Estado de la sincronización, para la UI.
 *
 * Lo único que el atleta necesita saber es si hay trabajo sin subir. Nada de
 * spinners bloqueantes: entrenar nunca espera a la red.
 */

import { create } from 'zustand';

import { drain, pending } from '@/sync/queue';

interface SyncState {
  /** Entradas sin subir. 0 = todo al día. */
  pending: number;
  /** true mientras el worker está vaciando. */
  running: boolean;
  /** true si el último intento se quedó sin red. */
  offline: boolean;
  /** ISO 8601 del último vaciado con éxito. */
  lastSyncedAt: string | null;

  refresh: () => Promise<void>;
  sync: () => Promise<void>;
}

export const useSync = create<SyncState>((set, get) => ({
  pending: 0,
  running: false,
  offline: false,
  lastSyncedAt: null,

  refresh: async () => {
    set({ pending: await pending() });
  },

  sync: async () => {
    set({ running: true });
    try {
      const result = await drain();
      set({
        pending: result.remaining,
        offline: result.offline,
        // Solo se mueve si de verdad subio algo; un intento en vacio no
        // cuenta como "sincronizado ahora".
        lastSyncedAt:
          result.sent > 0 ? new Date().toISOString() : get().lastSyncedAt,
      });
    } finally {
      set({ running: false });
    }
  },
}));

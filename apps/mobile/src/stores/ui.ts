/**
 * Estado de interfaz: qué está mirando el usuario.
 *
 * Deliberadamente separado del estado de dominio (stores/session.ts). En el
 * prototipo todo vivía en el mismo objeto plano, y esa mezcla es justo donde en
 * la Fase 3 va la capa de sincronización: lo de aquí NUNCA se sincroniza.
 */

import { create } from 'zustand';
import type { DeviationTarget } from '@/features/workout/DeviationSheet';

interface UiState {
  /** Ejercicio cuyo bottom sheet de feedback está abierto, o null. */
  feedbackFor: string | null;
  openFeedback: (exerciseId: string) => void;
  closeFeedback: () => void;

  /** Set cuyo menú está abierto: "<exerciseId>:<index>", o null. */
  setMenuFor: string | null;
  openSetMenu: (exerciseId: string, index: number) => void;
  closeSetMenu: () => void;

  /** Set sobre el que el atleta está reportando una desviación. */
  deviation: DeviationTarget | null;
  openDeviation: (t: DeviationTarget) => void;
  closeDeviation: () => void;

  /** Ejercicio que el coach está pautando. */
  editPlanFor: string | null;
  openEditPlan: (exerciseId: string) => void;
  closeEditPlan: () => void;

  /** Sheet de nuevo mesociclo. */
  newMesoOpen: boolean;
  openNewMeso: () => void;
  closeNewMeso: () => void;

  /** Filtros de la pantalla de Ejercicios. */
  /**
   * Filtro del catálogo: 'Todos' o una clave de músculo del servidor
   * (`CHEST`, `BACK`...).
   *
   * Es un string y no una unión cerrada a propósito: los músculos los define
   * el servidor, y si algún día añade uno, la app no debe dejar de compilar
   * por ello.
   */
  filter: string;
  query: string;
  setFilter: (f: string) => void;
  setQuery: (q: string) => void;
}

export const useUi = create<UiState>((set) => ({
  feedbackFor: null,
  openFeedback: (exerciseId) => set({ feedbackFor: exerciseId }),
  closeFeedback: () => set({ feedbackFor: null }),

  setMenuFor: null,
  openSetMenu: (exerciseId, index) => set({ setMenuFor: `${exerciseId}:${index}` }),
  closeSetMenu: () => set({ setMenuFor: null }),

  deviation: null,
  openDeviation: (deviation) => set({ deviation }),
  closeDeviation: () => set({ deviation: null }),

  editPlanFor: null,
  openEditPlan: (editPlanFor) => set({ editPlanFor }),
  closeEditPlan: () => set({ editPlanFor: null }),

  newMesoOpen: false,
  openNewMeso: () => set({ newMesoOpen: true }),
  closeNewMeso: () => set({ newMesoOpen: false }),

  filter: 'Todos',
  query: '',
  setFilter: (filter) => set({ filter }),
  setQuery: (query) => set({ query }),
}));

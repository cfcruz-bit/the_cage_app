/**
 * Cuándo se vacía la cola.
 *
 * Tres disparadores, y ninguno es un botón:
 *
 * 1. Al volver la app a primer plano. Es el momento con más probabilidad de
 *    tener red otra vez.
 * 2. Cada minuto mientras la app está visible.
 * 3. Cada vez que algo se encola (lo llama quien encola).
 *
 * No se usa NetInfo a propósito: sería una dependencia nativa más para saber
 * algo que el propio `fetch` ya nos dice al fallar. Si no hay red, el intento
 * falla rápido y el backoff se encarga.
 */

import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useSync } from '@/stores/sync';

const INTERVAL_MS = 60_000;

export function useAutoSync(enabled: boolean): void {
  const sync = useSync((s) => s.sync);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const run = (): void => {
      if (!cancelled) void sync();
    };

    run();

    const timer = setInterval(run, INTERVAL_MS);

    const onChange = (state: AppStateStatus): void => {
      if (state === 'active') run();
    };
    const subscription = AppState.addEventListener('change', onChange);

    return () => {
      cancelled = true;
      clearInterval(timer);
      subscription.remove();
    };
  }, [enabled, sync]);
}

/**
 * Un hook para pedir datos al servidor.
 *
 * Deliberadamente pequeño: tres estados (cargando, error, datos) y un
 * `reload`. No es React Query ni pretende serlo — esta app tiene cinco
 * pantallas y añadir una librería de caché por cinco pantallas es la clase de
 * decisión que se paga en cada actualización del SDK.
 *
 * Lo que sí hace bien es lo que importa aquí:
 *
 * - **Ignora respuestas viejas.** Si el coach abre dos fichas seguidas, la
 *   primera respuesta no puede pisar a la segunda. La bandera `stale` lo evita.
 * - **Distingue estar sin red de estar roto.** La UI puede decir "sin
 *   conexión" en vez de "algo salió mal", que es lo único que el usuario puede
 *   accionar.
 */

import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/api/client';
import { handlePaymentRequired } from '@/stores/auth';

export interface Remote<T> {
  data: T | null;
  loading: boolean;
  /** Mensaje listo para pintar. null si todo fue bien. */
  error: string | null;
  offline: boolean;
  reload: () => void;
}

export function useRemote<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
): Remote<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let stale = false;

    setLoading(true);
    setError(null);

    fetcher()
      .then((value) => {
        if (stale) return;
        setData(value);
        setOffline(false);
      })
      .catch((err: unknown) => {
        if (stale) return;
        // El acceso venció con la app abierta: que lo resuelva la puerta, no
        // esta pantalla.
        if (handlePaymentRequired(err)) return;
        const api = err instanceof ApiError ? err : null;
        setOffline(api?.offline === true);
        setError(
          api?.offline === true
            ? 'Sin conexión con el servidor.'
            : (api?.message ?? 'No se pudieron cargar los datos.'),
        );
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });

    return () => {
      stale = true;
    };
    // El fetcher se recrea en cada render; las dependencias reales las declara
    // quien llama, igual que en useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, error, offline, reload };
}

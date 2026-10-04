import { useCallback, useState } from 'react';

/**
 * Estado compartido para pantallas con botón "Actualizar".
 * - Carga inicial: loading=true
 * - Actualizar manual: refreshing=true (datos visibles)
 * - Polling: runLoad(task, { silent: true })
 */
export function useRefreshableLoad(initialLoading = true) {
  const [loading, setLoading] = useState(initialLoading);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(() => new Date());
  const [error, setError] = useState('');

  const runLoad = useCallback(async (task: () => Promise<unknown>, { manual = false, silent = false }: { manual?: boolean; silent?: boolean } = {}) => {
    if (manual) {
      setRefreshing(true);
    } else if (!silent) {
      setLoading(true);
    }

    try {
      await task();
      setError('');
      setLastUpdate(new Date());
    } catch {
      setError('No se pudieron actualizar los datos. Vuelve a intentarlo.');
    } finally {
      setLoading(false);
      if (manual) {
        setRefreshing(false);
      }
    }
  }, []);

  return {
    loading,
    refreshing,
    isBusy: loading || refreshing,
    lastUpdate,
    runLoad,
    error,
  };
}

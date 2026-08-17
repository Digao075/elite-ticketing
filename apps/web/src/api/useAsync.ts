import { useCallback, useEffect, useState } from 'react';

import { ApiError } from './client';

export type AsyncState<T> = { data: T | null; loading: boolean; error: string | null; reload: () => void };

/** Loads once and on demand, exposing the three states every screen must show. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    run()
      .then((result) => { if (active) setData(result); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Algo deu errado.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [run, attempt]);

  return { data, loading, error, reload: () => setAttempt((value) => value + 1) };
}

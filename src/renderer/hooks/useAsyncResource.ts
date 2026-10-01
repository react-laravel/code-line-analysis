import { useCallback, useEffect, useRef, useState } from 'react';

interface AsyncResourceOptions<T> {
  /** A folder id or other identity that must immediately clear stale data. */
  resourceKey: string | number | null;
  /** A scan revision or other cache-buster that reloads without blanking data. */
  refreshToken?: string | number;
  enabled?: boolean;
  initialData: T;
  load: () => Promise<T>;
  errorData?: (error: unknown) => T;
}

interface AsyncResource<T> {
  data: T;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

/**
 * Small query primitive for Tauri resources.
 *
 * It deliberately handles only the behaviour shared by this app: discard
 * stale responses, clear data when the resource identity changes, retain the
 * current value during revision refreshes, and expose an explicit retry.
 * Server-cache features from a network query library would add weight without
 * helping these local IPC calls.
 */
export function useAsyncResource<T>({
  resourceKey,
  refreshToken = 0,
  enabled = true,
  initialData,
  load,
  errorData,
}: AsyncResourceOptions<T>): AsyncResource<T> {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const initialDataRef = useRef(initialData);
  const errorDataRef = useRef(errorData);
  initialDataRef.current = initialData;
  errorDataRef.current = errorData;

  useEffect(() => {
    setData(initialDataRef.current);
    setError(null);
    setLoading(false);
  }, [resourceKey]);

  useEffect(() => {
    if (!enabled || resourceKey == null) return undefined;

    let cancelled = false;
    setLoading(true);
    setError(null);

    void load()
      .then(next => {
        if (cancelled) return;
        setData(next);
      })
      .catch(cause => {
        if (cancelled) return;
        // The identity-change effect clears old-folder data; a failed refresh
        // of the same identity should retain its last truthful result.
        if (errorDataRef.current) setData(errorDataRef.current(cause));
        setError(cause ?? new Error('Resource load failed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, load, refreshToken, reloadToken, resourceKey]);

  const reload = useCallback(() => setReloadToken(current => current + 1), []);

  return { data, loading, error, reload };
}

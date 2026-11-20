import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { AppStatus } from './types';

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (data: T) => void;
}

/** Load data from the API, with reload and optimistic local updates. */
export function useApi<T>(path: string | null): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (path === null) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .get<T>(path)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload, setData };
}

/** Poll /api/status; faster while waiting for a QR scan. */
export function useStatus(): { status: AppStatus | undefined; offline: boolean; refresh: () => void } {
  const [status, setStatus] = useState<AppStatus>();
  const [offline, setOffline] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    window.clearTimeout(timer.current);
    let next = 5000;
    try {
      const result = await api.get<AppStatus>('/api/status');
      setStatus(result);
      setOffline(false);
      if (result.whatsapp.state !== 'connected') {
        next = 2000;
      }
    } catch {
      setOffline(true);
      next = 3000;
    }
    timer.current = window.setTimeout(() => void load(), next);
  }, []);

  useEffect(() => {
    void load();
    return () => window.clearTimeout(timer.current);
  }, [load]);

  return { status, offline, refresh: () => void load() };
}

/** Minimal hash router: returns path segments of location.hash. */
export function useRoute(): string[] {
  const read = () =>
    window.location.hash
      .replace(/^#\/?/, '')
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
  const [route, setRoute] = useState(read);

  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function navigate(path: string): void {
  window.location.hash = path.startsWith('/') ? path : `/${path}`;
}

/** Debounce a changing value. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

import { useEffect, useState } from 'react';
import apiClient from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

let fetchPromise: Promise<string> | null = null;

export function invalidateGoogleConfig() {
  fetchPromise = null;
}

/** Client ID público de Google (GET /api/public/oauth/google/). */
export async function fetchGoogleClientId(): Promise<string> {
  if (!fetchPromise) {
    const request = apiClient
      .get(endpoints.public.googleOAuth)
      .then((res) => {
        const id = res.data?.client_id;
        return typeof id === 'string' ? id.trim() : '';
      })
      .finally(() => {
        // An older response must not evict the request started after a save.
        if (fetchPromise === request) fetchPromise = null;
      });
    fetchPromise = request;
  }
  return fetchPromise;
}

export function useGoogleConfig(enabled: boolean, attempt: number) {
  const [config, setConfig] = useState({ clientId: '', loading: true, refreshing: false, failed: false });

  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => {
      invalidateGoogleConfig();
      setRevision((value) => value + 1);
    };
    window.addEventListener('uasspain.google-config-updated', changed);
    return () => window.removeEventListener('uasspain.google-config-updated', changed);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    // Keep the confirmed result mounted while checking again: clearing it
    // unmounts the Google controls and shifts the rest of the login form.
    setConfig((current) => ({ ...current, refreshing: true }));
    fetchGoogleClientId().then((id) => {
      if (active) setConfig({ clientId: id, loading: false, refreshing: false, failed: false });
    }).catch(() => {
      if (active) setConfig({ clientId: '', loading: false, refreshing: false, failed: true });
    });
    return () => {
      active = false;
    };
  }, [enabled, attempt, revision]);

  return config;
}

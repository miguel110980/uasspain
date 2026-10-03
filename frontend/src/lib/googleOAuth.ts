import { useEffect, useState } from 'react';
import apiClient from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

let fetchPromise: Promise<string> | null = null;

/** Client ID público de Google (GET /api/public/oauth/google/). */
export async function fetchGoogleClientId(): Promise<string> {
  if (!fetchPromise) {
    fetchPromise = apiClient
      .get(endpoints.public.googleOAuth)
      .then((res) => {
        const id = res.data?.client_id;
        return typeof id === 'string' ? id.trim() : '';
      })
      .finally(() => {
        fetchPromise = null;
      });
  }
  return fetchPromise;
}

export function useGoogleConfig(enabled: boolean, attempt: number) {
  const [config, setConfig] = useState({ clientId: '', loading: true, failed: false });

  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((value) => value + 1);
    window.addEventListener('uasspain.google-config-updated', changed);
    return () => window.removeEventListener('uasspain.google-config-updated', changed);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setConfig({ clientId: '', loading: true, failed: false });
    fetchGoogleClientId().then((id) => {
      if (active) setConfig({ clientId: id, loading: false, failed: false });
    }).catch(() => {
      if (active) setConfig({ clientId: '', loading: false, failed: true });
    });
    return () => {
      active = false;
    };
  }, [enabled, attempt, revision]);

  return config;
}

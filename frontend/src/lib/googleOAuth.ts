import { useEffect, useState } from 'react';
import apiClient from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

let cachedClientId = null;
let fetchPromise = null;

/** Client ID público de Google (GET /api/public/oauth/google/). */
export async function fetchGoogleClientId() {
  if (cachedClientId) return cachedClientId;
  if (!fetchPromise) {
    fetchPromise = apiClient
      .get(endpoints.public.googleOAuth)
      .then((res) => {
        const id = res.data?.client_id;
        cachedClientId = typeof id === 'string' && id.trim() ? id.trim() : '';
        return cachedClientId;
      })
      .catch(() => {
        cachedClientId = '';
        return '';
      })
      .finally(() => {
        fetchPromise = null;
      });
  }
  return fetchPromise;
}

export function useGoogleClientId() {
  const [clientId, setClientId] = useState(cachedClientId || '');

  useEffect(() => {
    let active = true;
    fetchGoogleClientId().then((id) => {
      if (active) setClientId(id);
    });
    return () => {
      active = false;
    };
  }, []);

  return clientId;
}

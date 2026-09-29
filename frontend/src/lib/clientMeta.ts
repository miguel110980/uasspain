/** Metadatos del cliente para registro de conexiones. */

function parseUserAgent(ua = '') {
  let browser = 'Desconocido';
  let version = '';
  let os = 'Desconocido';
  let device = 'Escritorio';

  if (/Edg\//.test(ua)) {
    browser = 'Edge';
    version = ua.match(/Edg\/([\d.]+)/)?.[1] || '';
  } else if (/OPR\//.test(ua) || /Opera\//.test(ua)) {
    browser = 'Opera';
    version = ua.match(/(?:OPR|Opera)\/([\d.]+)/)?.[1] || '';
  } else if (/Chrome\//.test(ua)) {
    browser = 'Chrome';
    version = ua.match(/Chrome\/([\d.]+)/)?.[1] || '';
  } else if (/Firefox\//.test(ua)) {
    browser = 'Firefox';
    version = ua.match(/Firefox\/([\d.]+)/)?.[1] || '';
  } else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) {
    browser = 'Safari';
    version = ua.match(/Version\/([\d.]+)/)?.[1] || '';
  }

  if (/Android/.test(ua)) {
    os = 'Android';
    device = 'Móvil';
  } else if (/iPhone/.test(ua)) {
    os = 'iOS';
    device = 'Móvil';
  } else if (/iPad/.test(ua)) {
    os = 'iOS';
    device = 'Tablet';
  } else if (/Windows/.test(ua)) {
    os = 'Windows';
  } else if (/Mac OS X|Macintosh/.test(ua)) {
    os = 'macOS';
  } else if (/Linux/.test(ua)) {
    os = 'Linux';
  }

  if (device === 'Escritorio' && (/Mobile|Mobi/.test(ua))) {
    device = 'Móvil';
  }

  return { browser, version, os, device };
}

export async function collectClientMeta() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const parsed = parseUserAgent(ua);

  return {
    navegador: parsed.browser,
    version_navegador: parsed.version,
    sistema_operativo: parsed.os,
    tipo_dispositivo: parsed.device,
    zona_horaria: typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : '',
    idioma: typeof navigator !== 'undefined' ? navigator.language : '',
  };
}

export function encodeClientMeta(meta) {
  const bytes = new TextEncoder().encode(JSON.stringify(meta));
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

let metaCache = null;

export async function getEncodedClientMeta() {
  if (!metaCache) {
    metaCache = encodeClientMeta(await collectClientMeta());
  }
  return metaCache;
}

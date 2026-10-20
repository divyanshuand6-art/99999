import net from 'node:net';

function isPrivateOrLocalHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  const family = net.isIP(host);
  if (family === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (family === 6) return host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:') || host.startsWith('ff') || host.startsWith('2001:db8:');
  return false;
}

/**
 * Return the externally reachable base URL used in short links and QR codes.
 * In production, never silently generate localhost links: require an explicit
 * public HTTPS URL or Render's injected external URL.
 */
export function getPublicBaseUrl() {
  const configured = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '';
  if (!configured) {
    if (process.env.NODE_ENV === 'production') {
      throw Object.assign(new Error('PUBLIC_BASE_URL must be set to the deployed public API/domain URL in production.'), { status: 503 });
    }
    return `http://localhost:${Number(process.env.PORT || 4000)}`;
  }

  let url;
  try { url = new URL(configured); }
  catch { throw Object.assign(new Error('PUBLIC_BASE_URL must be a valid absolute HTTP(S) URL.'), { status: 500 }); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw Object.assign(new Error('PUBLIC_BASE_URL must be a public HTTP(S) URL without credentials.'), { status: 500 });
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw Object.assign(new Error('PUBLIC_BASE_URL must be an origin/domain without a path, query, or fragment.'), { status: 500 });
  }
  if (process.env.NODE_ENV === 'production' && (url.protocol !== 'https:' || isPrivateOrLocalHost(url.hostname))) {
    throw Object.assign(new Error('In production, PUBLIC_BASE_URL must be a public HTTPS domain, not localhost, a private IP, or an internal hostname.'), { status: 500 });
  }
  return url.origin.replace(/\/+$/, '');
}

export function makePublicShortUrl(code) {
  return `${getPublicBaseUrl()}/r/${encodeURIComponent(code)}`;
}

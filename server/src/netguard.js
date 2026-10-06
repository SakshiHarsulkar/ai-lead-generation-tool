import { promises as dns } from 'node:dns';
import net from 'node:net';

// SSRF guard: a user-supplied "company domain" must never make the server crawl its own network.
function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

const hostCache = new Map(); // in-memory: host -> Promise<{ ok, reason }>

/** Resolves `host` and checks it points at the public internet. Doubles as a fast "dead domain" check. */
export function checkHost(host) {
  if (!hostCache.has(host)) {
    hostCache.set(
      host,
      dns
        .lookup(host, { all: true })
        .then((addresses) =>
          addresses.some((a) => isPrivateAddress(a.address))
            ? { ok: false, reason: 'Resolves to a private network address (blocked)' }
            : { ok: true },
        )
        .catch((err) => ({
          ok: false,
          reason: err.code === 'ENOTFOUND' || err.code === 'ENODATA' ? 'Domain does not exist (no DNS record)' : `DNS lookup failed (${err.code ?? 'error'})`,
        })),
    );
    if (hostCache.size > 5000) hostCache.delete(hostCache.keys().next().value);
  }
  return hostCache.get(host);
}

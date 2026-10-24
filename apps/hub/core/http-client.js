// Outbound HTTP for provider calls (handler ctx.http): timeout, no redirects, and an SSRF guard
// for user-supplied URLs (e.g. a WordPress site URL). Unless `allowPrivate` (dev/test:
// HUB_ALLOW_PRIVATE_URLS=1), only https to public addresses is allowed.
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { HandlerError } from './extension.js';

const blocked = new BlockList();
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 4]]) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) blocked.addSubnet(net, prefix, 'ipv6');

const isBlocked = (address) => {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  return mapped ? blocked.check(mapped, 'ipv4') : blocked.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
};

// Throws HandlerError('invalid_input') when the URL may not be called.
export async function assertAllowedUrl(url, { allowPrivate = false } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new HandlerError('invalid_input', 'not a valid URL');
  }
  if (!['https:', ...(allowPrivate ? ['http:'] : [])].includes(parsed.protocol)) throw new HandlerError('invalid_input', 'URL must use https');
  if (parsed.username || parsed.password) throw new HandlerError('invalid_input', 'URL must not contain credentials');
  if (allowPrivate) return;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new HandlerError('invalid_input', `cannot resolve ${host}`);
  if (addresses.some(isBlocked)) throw new HandlerError('invalid_input', 'URL resolves to a private or local address');
}

export const createHttpClient = ({ allowPrivate = false, timeoutMs = 10_000 } = {}) =>
  async (url, init = {}) => {
    await assertAllowedUrl(url, { allowPrivate });
    try {
      return await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new HandlerError('provider_unavailable', `request failed: ${err.name}`);
    }
  };

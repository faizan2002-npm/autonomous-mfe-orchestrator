import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

/** Address ranges an org-supplied URL must never reach: internal networks and cloud metadata. */
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(network, prefix, 'ipv6');

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family !== 6) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return mapped
    ? blocked.check(mapped[1], 'ipv4')
    : blocked.check(address, 'ipv6');
}

export class UnsafeUrlError extends Error {}

function resolveAll(hostname: string): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) =>
    dnsLookup(hostname, { all: true }, (error, addresses) =>
      error ? reject(error) : resolve(addresses),
    ),
  );
}

/** Validates an org-supplied URL when it is saved, with a readable error. */
export async function assertSafeUrl(
  raw: string,
  allowPrivate: boolean,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new UnsafeUrlError('Only http and https URLs are allowed');
  if (url.username || url.password)
    throw new UnsafeUrlError(
      'Put credentials in upstream headers, not in the URL',
    );
  if (allowPrivate) return url;
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await resolveAll(hostname).catch(() => {
        throw new UnsafeUrlError(`Could not resolve ${hostname}`);
      });
  if (addresses.some(({ address }) => isBlockedAddress(address)))
    throw new UnsafeUrlError(
      `${hostname} resolves to a private or reserved address`,
    );
  return url;
}

/**
 * fetch that refuses to connect to blocked addresses. The check runs on the address actually
 * dialled, so DNS rebinding between validation and request cannot reach internal hosts.
 */
export function createGuardedFetch(allowPrivate: boolean): typeof fetch {
  if (allowPrivate) return fetch;
  const dispatcher = new Agent({
    connect: {
      lookup: (hostname, options, callback) =>
        dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
          if (error) return callback(error, '', 0);
          const list = addresses as LookupAddress[];
          const unsafe = list.find(({ address }) => isBlockedAddress(address));
          if (unsafe)
            return callback(
              new UnsafeUrlError(`Blocked connection to ${unsafe.address}`),
              '',
              0,
            );
          if ((options as { all?: boolean }).all)
            return callback(null, list as never, 0);
          return callback(null, list[0].address, list[0].family);
        }),
    },
  });
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    undiciFetch(
      input as string,
      {
        ...(init as object),
        dispatcher,
      } as never,
    )) as unknown as typeof fetch;
}

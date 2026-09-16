import { lookup, type LookupAddress, type LookupOptions } from "dns";
import { BlockList, isIP } from "net";
import { Agent, fetch as undiciFetch } from "undici";

type DnsLookupFn = (
  hostname: string,
  options: LookupOptions,
  callback: DnsLookupCallback,
) => void;

type DnsLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[] | undefined,
  family?: number,
) => void;

type LookupHookCallback = (
  error: NodeJS.ErrnoException | Error | null,
  address?: string | LookupAddress[],
  family?: number,
) => void;

const blockedAddresses = new BlockList();
const proxyFakeAddresses = new BlockList();
proxyFakeAddresses.addSubnet("198.18.0.0", 15, "ipv4");
proxyFakeAddresses.addSubnet("::ffff:198.18.0.0", 111, "ipv6");

interface DnsLookupPolicy {
  allowProxyFakeIp?: boolean;
}

// Derived, not hand-duplicated: Node's BlockList matches addresses across
// families through their IPv4-mapped-IPv6 form regardless of which `type`
// you pass to check()/addSubnet() (see the addAddress('123.123.123.123') /
// check('::ffff:123.123.123.123') example on
// https://nodejs.org/api/net.html#class-netblocklist). So every IPv4 range
// below needs an "::ffff:<net>" mirror in the IPv6 list, or a spoofed
// literal like "::ffff:127.0.0.1" slips through unblocked. Generating the
// mirror from this list instead of maintaining two lists by hand means the
// two can't drift out of sync the way they did before.
const blockedIpv4Ranges = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
] as const;

for (const [network, prefix] of blockedIpv4Ranges) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
  blockedAddresses.addSubnet(`::ffff:${network}`, prefix + 96, "ipv6");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  return (
    family === 0 ||
    blockedAddresses.check(address, family === 4 ? "ipv4" : "ipv6")
  );
}

export function isProxyFakeIpAddress(address: string): boolean {
  const family = isIP(address);
  return (
    family !== 0 &&
    proxyFakeAddresses.check(address, family === 4 ? "ipv4" : "ipv6")
  );
}

// Extracted so the blocklist decision can be tested directly against a
// fake DNS resolver, instead of only through a real fetch()/Agent call —
// the actual bug here lived entirely in this callback, several layers
// below where undici's own "fetch failed" wrapping would otherwise hide it.
export function createDnsLookupHook(
  dnsLookup: DnsLookupFn = lookup,
  policy: DnsLookupPolicy = {},
) {
  return function lookupHook(
    host: string,
    lookupOptions: LookupOptions,
    callback: LookupHookCallback,
  ): void {
    const cleanHost = String(host ?? "").replace(/^[|]$/g, "");
    const lookupAll = lookupOptions.all === true;

    dnsLookup(
      cleanHost,
      { ...lookupOptions, all: true, verbatim: true },
      (error, addresses, family) => {
        if (error) {
          return callback(error, "", 0);
        }

        const addrs = Array.isArray(addresses)
          ? addresses
          : addresses != null
            ? [{ address: addresses, family: family ?? isIP(addresses) }]
            : undefined;

        if (addrs === undefined) {
          return callback(
            new Error("DNS lookup returned invalid address"),
            "",
            0,
          );
        }

        if (!addrs.length) {
          return callback(
            new Error("DNS resolution returned no addresses"),
            "",
            0,
          );
        }

        if (
          addrs.some(
            ({ address }) =>
              isBlockedAddress(address) &&
              !(policy.allowProxyFakeIp && isProxyFakeIpAddress(address)),
          )
        ) {
          return callback(
            new Error("Private destinations are not allowed"),
            "",
            0,
          );
        }

        if (lookupAll) {
          return callback(null, addrs, 0);
        }

        const result = addrs[0];
        const addr = String(result.address ?? "").replace(/^\[|\]$/g, "");
        const fam =
          typeof result.family === "number" ? result.family : isIP(addr);

        if (!addr || isIP(addr) === 0) {
          return callback(
            new Error("DNS lookup returned invalid address"),
            "",
            0,
          );
        }

        return callback(null, addr, fam);
      },
    );
  };
}

type DispatcherLifecycle = Pick<Agent, "close" | "destroy">;

function ignoreCleanupFailure(task: Promise<void>): void {
  void task.catch(() => {});
}

/**
 * Keeps the per-request Agent alive while callers consume the response body.
 * Closing it before returning the Response waits for the upstream stream to
 * finish while the unread body is applying backpressure, which can deadlock a
 * normal-sized model response. Completion closes gracefully; cancellation or
 * a read failure tears the connection down immediately.
 */
export function wrapResponseWithDispatcherLifecycle(
  response: Response,
  dispatcher: DispatcherLifecycle,
): Response {
  let settled = false;
  const settle = (completed: boolean, reason?: unknown) => {
    if (settled) return;
    settled = true;
    if (completed) {
      ignoreCleanupFailure(dispatcher.close());
      return;
    }
    ignoreCleanupFailure(
      dispatcher.destroy(
        reason instanceof Error
          ? reason
          : new Error("Outbound response cancelled"),
      ),
    );
  };

  const source = response.body;
  if (!source) {
    settle(true);
    return response;
  }

  const reader = source.getReader();
  const release = () => {
    try {
      reader.releaseLock();
    } catch {
      // A concurrent cancellation can release the lock first.
    }
  };

  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const next = await reader.read();
          if (settled) return;
          if (next.done) {
            release();
            controller.close();
            settle(true);
            return;
          }
          controller.enqueue(next.value);
        } catch (error) {
          release();
          try {
            controller.error(error);
          } catch {
            // The consumer may already have cancelled its side of the stream.
          }
          settle(false, error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          release();
          settle(false, reason);
        }
      },
    },
    { highWaterMark: 0 },
  );

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function safeOutboundFetch(
  rawUrl: string,
  options: RequestInit,
  policy: DnsLookupPolicy = {},
): Promise<Response> {
  const url = new URL(rawUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("Invalid outbound URL");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) && isBlockedAddress(hostname)) {
    throw new Error("Private destinations are not allowed");
  }

  const dispatcher = new Agent({
    connect: {
      lookup: createDnsLookupHook(lookup, policy),
    },
  });

  try {
    const response = await undiciFetch(url.toString(), {
      ...options,
      dispatcher,
      redirect: "error",
    });
    return wrapResponseWithDispatcherLifecycle(response, dispatcher);
  } catch (error) {
    try {
      await dispatcher.destroy(error instanceof Error ? error : null);
    } catch {
      // Preserve the request error; dispatcher cleanup is best effort here.
    }
    throw error;
  }
}

import { getErrorMessage } from "./error-message.js";
import { SocksClient, type SocksClientOptions } from "socks";
import net from "net";
import dns from "dns/promises";
import { sshLogger } from "./logger.js";
import { isBlockedAddress } from "./safe-outbound-fetch.js";
import type { ProxyNode } from "../../types/index.js";

async function validateHost(host: string): Promise<void> {
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new Error("Proxy target address is not allowed");
    }
    return;
  }

  const { address } = await dns.lookup(host);
  if (isBlockedAddress(address)) {
    throw new Error("Proxy target address is not allowed");
  }
}

export interface SOCKS5Config {
  useSocks5?: boolean;
  socks5Host?: string;
  socks5Port?: number;
  socks5Username?: string;
  socks5Password?: string;
  socks5ProxyChain?: ProxyNode[];
}

export async function createSocks5Connection(
  targetHost: string,
  targetPort: number,
  socks5Config: SOCKS5Config,
  signal?: AbortSignal,
): Promise<net.Socket | null> {
  signal?.throwIfAborted();
  if (!socks5Config.useSocks5) {
    return null;
  }

  if (
    socks5Config.socks5ProxyChain &&
    socks5Config.socks5ProxyChain.length > 0
  ) {
    return createMixedProxyChainConnection(
      targetHost,
      targetPort,
      socks5Config.socks5ProxyChain,
      signal,
    );
  }

  if (socks5Config.socks5Host) {
    return createSingleProxyConnection(
      targetHost,
      targetPort,
      socks5Config,
      signal,
    );
  }

  return null;
}

async function createSingleProxyConnection(
  targetHost: string,
  targetPort: number,
  socks5Config: SOCKS5Config,
  signal?: AbortSignal,
): Promise<net.Socket> {
  const socksOptions: SocksClientOptions = {
    proxy: {
      host: socks5Config.socks5Host!,
      port: socks5Config.socks5Port || 1080,
      type: 5,
      userId: socks5Config.socks5Username,
      password: socks5Config.socks5Password,
    },
    command: "connect",
    destination: {
      host: targetHost,
      port: targetPort,
    },
  };

  try {
    return await connectSocksProxy(socksOptions, signal);
  } catch (error) {
    sshLogger.error("SOCKS5 connection failed", error, {
      operation: "socks5_connect_failed",
      proxyHost: socks5Config.socks5Host,
      proxyPort: socks5Config.socks5Port || 1080,
      targetHost,
      targetPort,
      errorMessage: getErrorMessage(error),
    });
    throw error;
  }
}

async function connectSocksProxy(
  options: SocksClientOptions,
  signal?: AbortSignal,
): Promise<net.Socket> {
  if (!signal) return (await SocksClient.createConnection(options)).socket;
  signal.throwIfAborted();
  const socket =
    (options.existing_socket as net.Socket | undefined) ?? new net.Socket();
  const abort = () => socket.destroy();
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (!options.existing_socket) {
      await new Promise<void>((resolve, reject) => {
        const closed = () =>
          reject(signal.reason ?? Error("PROXY_CONNECTION_CLOSED"));
        socket.once("close", closed);
        socket.once("error", reject);
        socket.setTimeout(30000, () =>
          socket.destroy(Error("PROXY_CONNECTION_TIMEOUT")),
        );
        socket.connect(options.proxy.port, options.proxy.host, () => {
          socket.off("close", closed);
          socket.off("error", reject);
          socket.setTimeout(0);
          resolve();
        });
      });
    }
    signal.throwIfAborted();
    const info = await SocksClient.createConnection({
      ...options,
      existing_socket: socket,
    });
    signal.throwIfAborted();
    return info.socket;
  } catch (error) {
    socket.destroy();
    throw signal.aborted ? signal.reason : error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function createHttpConnectConnection(
  targetHost: string,
  targetPort: number,
  proxyHost: string,
  proxyPort: number,
  username?: string,
  password?: string,
  existingSocket?: net.Socket,
  signal?: AbortSignal,
): Promise<net.Socket> {
  signal?.throwIfAborted();
  let ownedSocket = existingSocket;
  let abort: (() => void) | undefined;
  return new Promise<net.Socket>((resolve, reject) => {
    abort = () => {
      clearTimeout(timeout);
      ownedSocket?.destroy();
      reject(signal?.reason ?? Error("PROXY_CONNECTION_CANCELLED"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => {
      ownedSocket?.destroy();
      reject(
        new Error(
          `HTTP CONNECT proxy timeout connecting to ${proxyHost}:${proxyPort}`,
        ),
      );
    }, 15000);

    function sendConnect(socket: net.Socket) {
      let connectReq = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n`;
      if (username && password) {
        const credentials = Buffer.from(`${username}:${password}`).toString(
          "base64",
        );
        connectReq += `Proxy-Authorization: Basic ${credentials}\r\n`;
      }
      connectReq += "\r\n";

      let responseBuffer = "";

      function onData(chunk: Buffer) {
        responseBuffer += chunk.toString("utf8");
        const headerEnd = responseBuffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;

        clearTimeout(timeout);
        socket.removeListener("data", onData);
        socket.removeListener("error", onError);

        const statusLine = responseBuffer.slice(
          0,
          responseBuffer.indexOf("\r\n"),
        );
        const statusCode = parseInt(statusLine.split(" ")[1], 10);

        if (statusCode === 200) {
          resolve(socket);
        } else {
          socket.destroy();
          reject(
            new Error(
              `HTTP CONNECT proxy returned ${statusCode}: ${statusLine}`,
            ),
          );
        }
      }

      function onError(err: Error) {
        clearTimeout(timeout);
        reject(new Error(`HTTP CONNECT proxy error: ${err.message}`));
      }

      socket.on("data", onData);
      socket.on("error", onError);
      socket.write(connectReq);
    }

    if (existingSocket) {
      sendConnect(existingSocket);
    } else {
      const socket = net.connect(proxyPort, proxyHost, () => {
        if (!signal?.aborted) sendConnect(socket);
      });
      ownedSocket = socket;

      socket.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`HTTP CONNECT proxy TCP error: ${err.message}`));
      });
    }
  }).finally(() => {
    if (abort) signal?.removeEventListener("abort", abort);
  });
}

export async function createMixedProxyChainConnection(
  targetHost: string,
  targetPort: number,
  proxyChain: ProxyNode[],
  signal?: AbortSignal,
): Promise<net.Socket> {
  signal?.throwIfAborted();
  if (proxyChain.length === 0) {
    throw new Error("Proxy chain is empty");
  }

  const hasMixedTypes = proxyChain.some((p) => p.type === "http");

  if (!hasMixedTypes && !signal) {
    return createPureSocksChainConnection(targetHost, targetPort, proxyChain);
  }

  return createHopByHopConnection(targetHost, targetPort, proxyChain, signal);
}

function socksProxyType(type: ProxyNode["type"]): 4 | 5 {
  if (type === 4 || type === "socks4") return 4;
  if (type === 5 || type === "socks5") return 5;
  throw Error("Invalid SOCKS proxy type");
}

async function createPureSocksChainConnection(
  targetHost: string,
  targetPort: number,
  proxyChain: ProxyNode[],
): Promise<net.Socket> {
  try {
    const info = await SocksClient.createConnectionChain({
      proxies: proxyChain.map((p) => ({
        host: p.host,
        port: p.port,
        type: socksProxyType(p.type),
        userId: p.username,
        password: p.password,
        timeout: 10000,
      })),
      command: "connect",
      destination: {
        host: targetHost,
        port: targetPort,
      },
    });
    return info.socket;
  } catch (error) {
    sshLogger.error("SOCKS proxy chain connection failed", error, {
      operation: "socks5_chain_connect_failed",
      chainLength: proxyChain.length,
      targetHost,
      targetPort,
      errorMessage: getErrorMessage(error),
    });
    throw error;
  }
}

async function createHopByHopConnection(
  targetHost: string,
  targetPort: number,
  proxyChain: ProxyNode[],
  signal?: AbortSignal,
): Promise<net.Socket> {
  let currentSocket: net.Socket | null = null;

  try {
    for (let i = 0; i < proxyChain.length; i++) {
      signal?.throwIfAborted();
      const node = proxyChain[i];
      const isLast = i === proxyChain.length - 1;
      const nextTarget = isLast
        ? { host: targetHost, port: targetPort }
        : { host: proxyChain[i + 1].host, port: proxyChain[i + 1].port };

      if (node.type === "http") {
        currentSocket = await createHttpConnectConnection(
          nextTarget.host,
          nextTarget.port,
          node.host,
          node.port,
          node.username,
          node.password,
          currentSocket ?? undefined,
          signal,
        );
      } else {
        const socksOptions: SocksClientOptions = {
          proxy: {
            host: node.host,
            port: node.port,
            type: socksProxyType(node.type),
            userId: node.username,
            password: node.password,
          },
          command: "connect",
          destination: nextTarget,
        };
        if (currentSocket) {
          socksOptions.existing_socket = currentSocket;
        }
        currentSocket = await connectSocksProxy(socksOptions, signal);
      }
    }

    if (!currentSocket) {
      throw new Error("Proxy chain produced no socket");
    }
    return currentSocket;
  } catch (error) {
    if (currentSocket) {
      currentSocket.destroy();
    }
    sshLogger.error("Mixed proxy chain connection failed", error, {
      operation: "mixed_chain_connect_failed",
      chainLength: proxyChain.length,
      targetHost,
      targetPort,
      errorMessage: getErrorMessage(error),
    });
    throw error;
  }
}

export async function testProxyConnectivity(options: {
  singleProxy?: {
    host: string;
    port: number;
    type?: 4 | 5 | "http";
    username?: string;
    password?: string;
  };
  proxyChain?: ProxyNode[];
  testTarget?: { host: string; port: number };
}): Promise<{ success: boolean; latencyMs: number }> {
  const target = options.testTarget ?? { host: "google.com", port: 443 };

  await validateHost(target.host);
  if (options.singleProxy) {
    await validateHost(options.singleProxy.host);
  }
  if (options.proxyChain) {
    for (const node of options.proxyChain) {
      await validateHost(node.host);
    }
  }

  const start = Date.now();

  let socket: net.Socket | null = null;
  try {
    if (options.proxyChain && options.proxyChain.length > 0) {
      socket = await createMixedProxyChainConnection(
        target.host,
        target.port,
        options.proxyChain,
      );
    } else if (options.singleProxy) {
      const proxy = options.singleProxy;
      if (proxy.type === "http") {
        socket = await createHttpConnectConnection(
          target.host,
          target.port,
          proxy.host,
          proxy.port,
          proxy.username,
          proxy.password,
        );
      } else {
        const socksOptions: SocksClientOptions = {
          proxy: {
            host: proxy.host,
            port: proxy.port,
            type: (proxy.type as 4 | 5) || 5,
            userId: proxy.username,
            password: proxy.password,
          },
          command: "connect",
          destination: target,
          timeout: 10000,
        };
        const info = await SocksClient.createConnection(socksOptions);
        socket = info.socket;
      }
    } else {
      throw new Error("No proxy configuration provided");
    }

    const latencyMs = Date.now() - start;
    socket.destroy();
    return { success: true, latencyMs };
  } catch (error) {
    if (socket) socket.destroy();
    throw error;
  }
}

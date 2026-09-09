import type { TunnelConfig } from "../../../types/index.js";
import { tunnelHostVerifier } from "./connection-trust.js";
import { Client, type ClientChannel } from "ssh2";
import type { Duplex } from "stream";
import { SSH_ALGORITHMS } from "../../utils/ssh-algorithms.js";
import { tunnelLogger } from "../../utils/logger.js";

export function getManagedTunnelAlgorithms() {
  return {
    kex: [
      "curve25519-sha256",
      "curve25519-sha256@libssh.org",
      "ecdh-sha2-nistp521",
      "ecdh-sha2-nistp384",
      "ecdh-sha2-nistp256",
      "diffie-hellman-group-exchange-sha256",
      "diffie-hellman-group14-sha256",
      "diffie-hellman-group14-sha1",
      "diffie-hellman-group-exchange-sha1",
      "diffie-hellman-group1-sha1",
    ],
    serverHostKey: [
      "ssh-ed25519",
      "ecdsa-sha2-nistp521",
      "ecdsa-sha2-nistp384",
      "ecdsa-sha2-nistp256",
      "rsa-sha2-512",
      "rsa-sha2-256",
      "ssh-rsa",
      "ssh-dss",
    ],
    cipher: SSH_ALGORITHMS.cipher,
    hmac: [
      "hmac-sha2-512-etm@openssh.com",
      "hmac-sha2-256-etm@openssh.com",
      "hmac-sha2-512",
      "hmac-sha2-256",
      "hmac-sha1",
      "hmac-md5",
    ],
    compress: ["none", "zlib@openssh.com", "zlib"],
  };
}

export function applyAuthOptions(
  connOptions: Record<string, unknown>,
  credentials: {
    password?: string;
    sshKey?: string;
    keyPassword?: string;
    keyType?: string;
    authMethod?: string;
  },
): void {
  if (credentials.authMethod === "key" && credentials.sshKey) {
    const cleanKey = credentials.sshKey
      .trim()
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    connOptions.privateKey = Buffer.from(cleanKey, "utf8");
    if (credentials.keyPassword) {
      connOptions.passphrase = credentials.keyPassword;
    }
    if (credentials.keyType && credentials.keyType !== "auto") {
      connOptions.privateKeyType = credentials.keyType;
    }
  } else {
    connOptions.password = credentials.password;
  }
}

/** The signal owns the SSH client until it closes, including after ready. */
export async function connectClient(
  connOptions: Record<string, unknown>,
  tunnelName: string,
  role: "source" | "endpoint",
  config: TunnelConfig,
  signal?: AbortSignal,
): Promise<Client> {
  const client = new Client();
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
      (connOptions.sock as { destroy?: () => void } | undefined)?.destroy?.();
      client.destroy();
    };
    const abort = () =>
      fail(signal?.reason ?? Error("TUNNEL_CONNECTION_CANCELLED"));
    signal?.addEventListener("abort", abort, { once: true });
    client.once("ready", () => {
      if (signal?.aborted || settled) return;
      settled = true;
      resolve(client);
    });
    client.once("close", () => {
      signal?.removeEventListener("abort", abort);
      if (!settled) fail(Error("TUNNEL_CONNECTION_CLOSED"));
    });
    client.on("error", (error) => {
      if (!settled) return fail(error);
      if (!signal?.aborted)
        tunnelLogger.error("Managed tunnel SSH client error", error, {
          operation: "managed_tunnel_client_error",
          tunnelName,
          role,
        });
    });
    void (async () => {
      signal?.throwIfAborted();
      const hostVerifier = await tunnelHostVerifier(client, config, role);
      signal?.throwIfAborted();
      if (!settled) client.connect({ ...connOptions, hostVerifier });
    })().catch((error) => {
      signal?.removeEventListener("abort", abort);
      fail(error);
    });
  });
}

export function forwardOut(
  client: Client,
  targetHost: string,
  targetPort: number,
  tunnelName?: string,
  signal?: AbortSignal,
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const detach = () => {
      signal?.removeEventListener("abort", abort);
      client.off("close", closed);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      detach();
      reject(error);
    };
    const abort = () =>
      fail(signal?.reason ?? Error("TUNNEL_CONNECTION_CANCELLED"));
    const closed = () => fail(Error("TUNNEL_CONNECTION_CLOSED"));
    signal?.addEventListener("abort", abort, { once: true });
    client.once("close", closed);
    if (signal?.aborted) return abort();
    try {
      client.forwardOut(
        "127.0.0.1",
        0,
        targetHost,
        targetPort,
        (err, stream) => {
          if (settled || signal?.aborted) {
            stream?.destroy();
            return;
          }
          if (err) {
            if (tunnelName)
              tunnelLogger.error("Managed tunnel forwardOut failed", err, {
                operation: "managed_tunnel_forward_out_failed",
                tunnelName,
                targetHost,
                targetPort,
              });
            fail(err);
            return;
          }
          settled = true;
          detach();
          resolve(stream);
        },
      );
    } catch (error) {
      fail(error);
    }
  });
}

export function bindForwardIn(
  client: Client,
  bindHost: string,
  bindPort: number,
  signal?: AbortSignal,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const detach = () => {
      signal?.removeEventListener("abort", abort);
      client.off("close", closed);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      detach();
      reject(error);
    };
    const abort = () =>
      fail(signal?.reason ?? Error("TUNNEL_CONNECTION_CANCELLED"));
    const closed = () => fail(Error("TUNNEL_CONNECTION_CLOSED"));
    signal?.addEventListener("abort", abort, { once: true });
    client.once("close", closed);
    if (signal?.aborted) return abort();
    try {
      client.forwardIn(bindHost, bindPort, (err, actualPort) => {
        if (settled || signal?.aborted) {
          if (!err) unbindForwardIn(client, bindHost, actualPort || bindPort);
          return;
        }
        if (err) return fail(err);
        settled = true;
        detach();
        resolve(actualPort || bindPort);
      });
    } catch (error) {
      fail(error);
    }
  });
}

export function unbindForwardIn(
  client: Client,
  bindHost: string,
  bindPort: number,
): void {
  try {
    client.unforwardIn(bindHost, bindPort, (err) => {
      if (err) {
        tunnelLogger.warn("Failed to unbind managed tunnel listener", {
          operation: "managed_tunnel_unforward_failed",
          bindHost,
          bindPort,
          error: err.message,
        });
      }
    });
  } catch {
    // The connection may already be gone.
  }
}

export function pipeTunnelStreams(
  inbound: Duplex,
  outboundPromise: Promise<Duplex>,
  tunnelName: string,
): void {
  let outbound: Duplex | undefined,
    closed = false;
  const close = () => {
    closed = true;
    outbound?.destroy();
  };
  inbound.once("close", close);
  inbound.once("error", () => {
    close();
    inbound.destroy();
  });
  outboundPromise
    .then((stream) => {
      outbound = stream;
      if (closed || inbound.destroyed) {
        stream.destroy();
        return;
      }
      stream.once("error", () => {
        inbound.destroy();
        stream.destroy();
      });
      stream.once("close", () => inbound.destroy());
      inbound.pipe(stream).pipe(inbound);
    })
    .catch((error) => {
      tunnelLogger.error(
        "Failed to open managed tunnel outbound stream",
        error,
        { operation: "managed_tunnel_outbound_failed", tunnelName },
      );
      inbound.destroy();
    });
}

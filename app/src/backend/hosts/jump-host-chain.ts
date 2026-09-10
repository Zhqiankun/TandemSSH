import { Client as SSHClient } from "ssh2";
import { randomUUID } from "node:crypto";
import { attachInteractiveAuth } from "./interactive-auth/production.js";
import { fileLogger } from "../utils/logger.js";
import { createSocks5Connection } from "../utils/socks5-helper.js";
import { SSH_ALGORITHMS } from "../utils/ssh-algorithms.js";
import { preparePrivateKeyForSSH2 } from "../utils/ssh-key-utils.js";
import { getErrorMessage } from "../utils/error-message.js";
import { SSHHostKeyVerifier } from "./host-key-verifier.js";
import { getJumpHostSocks5Config } from "./jump-host-proxy.js";
import { applyAgentAuth } from "./terminal-auth-helpers.js";
import { resolveHostById } from "./host-resolver.js";

type JumpHostConfig = {
  id: number;
  ip: string;
  port: number;
  username: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  authType?: string;
  credentialId?: number;
  useSocks5?: boolean | null;
  socks5Host?: string | null;
  socks5Port?: number | null;
  socks5Username?: string | null;
  socks5Password?: string | null;
  socks5ProxyChain?: string | import("../../types/index.js").ProxyNode[] | null;
  [key: string]: unknown;
};

async function resolveJumpHost(
  hostId: number,
  userId: string,
): Promise<JumpHostConfig | null> {
  try {
    return (await resolveHostById(
      hostId,
      userId,
    )) as unknown as JumpHostConfig | null;
  } catch (error) {
    fileLogger.error("Failed to resolve jump host", error, {
      operation: "resolve_jump_host",
      hostId,
      userId,
    });
    return null;
  }
}

export class JumpHostChainError extends Error {
  constructor(
    message: string,
    readonly hopIndex: number,
    readonly totalHops: number,
  ) {
    super(message);
    this.name = "JumpHostChainError";
  }
}

export async function createJumpHostChain(
  jumpHosts: Array<{ hostId: number }>,
  userId: string,
  signal?: AbortSignal,
  interaction?: { keyboardInteractiveVersion: 1; onPrompt?: () => void },
): Promise<SSHClient | null> {
  signal?.throwIfAborted();
  if (!jumpHosts || jumpHosts.length === 0) {
    return null;
  }

  let currentClient: SSHClient | null = null;
  const clients: SSHClient[] = [];
  let proxySocket: import("net").Socket | null = null;
  const abort = () => {
    proxySocket?.destroy();
    clients.forEach((client) => client.destroy());
  };
  signal?.addEventListener("abort", abort, { once: true });

  try {
    const jumpHostConfigs: Array<Awaited<ReturnType<typeof resolveJumpHost>>> =
      [];
    for (let i = 0; i < jumpHosts.length; i++) {
      signal?.throwIfAborted();
      const config = await resolveJumpHost(jumpHosts[i].hostId, userId);
      signal?.throwIfAborted();
      jumpHostConfigs.push(config);
    }

    const totalHops = jumpHostConfigs.length;

    for (let i = 0; i < jumpHostConfigs.length; i++) {
      if (!jumpHostConfigs[i]) {
        fileLogger.error(`Jump host ${i + 1} not found`, undefined, {
          operation: "jump_host_chain",
          hostId: jumpHosts[i].hostId,
          hopIndex: i,
          totalHops,
        });
        clients.forEach((c) => c.end());
        throw new JumpHostChainError(
          `Jump host ${i + 1} of ${totalHops} was not found`,
          i,
          totalHops,
        );
      }
    }

    const firstHopSocks5Config = getJumpHostSocks5Config(jumpHostConfigs[0]);
    if (firstHopSocks5Config?.useSocks5) {
      const firstHop = jumpHostConfigs[0]!;
      proxySocket = await createSocks5Connection(
        firstHop.ip,
        firstHop.port || 22,
        firstHopSocks5Config,
        signal,
      );
      signal?.throwIfAborted();
    }

    for (let i = 0; i < jumpHostConfigs.length; i++) {
      const jumpHostConfig = jumpHostConfigs[i]!;

      signal?.throwIfAborted();
      const jumpClient = new SSHClient();
      jumpClient.on("error", () => {});
      clients.push(jumpClient);

      const jumpHostVerifier = await SSHHostKeyVerifier.createHostVerifier(
        jumpHostConfig.id,
        jumpHostConfig.ip,
        jumpHostConfig.port || 22,
        null,
        userId,
        true,
        undefined,
        jumpClient,
      );

      signal?.throwIfAborted();
      let lastError: Error | null = null;

      const connected = await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (value: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          signal?.removeEventListener("abort", cancelled);
          resolve(value);
        };
        const cancelled = () => {
          lastError = signal?.reason ?? Error("SSH_CONNECTION_CANCELLED");
          finish(false);
        };
        const readyTimeoutMs = interaction ? 310000 : 60000;
        const timeout = setTimeout(() => {
          lastError = new Error(
            `Timed out waiting for jump host ${i + 1}/${totalHops} to authenticate`,
          );
          finish(false);
          // ssh2 has no explicit cancel; ending the client stops it from
          // firing "ready"/"error" after we've already resolved.
          jumpClient.end();
        }, readyTimeoutMs + 5000);

        signal?.addEventListener("abort", cancelled, { once: true });
        if (signal?.aborted) {
          cancelled();
          return;
        }
        jumpClient.once("close", () => {
          if (!settled) {
            lastError = Error("SSH_CONNECTION_CLOSED");
            finish(false);
          }
        });
        jumpClient.on("ready", () => {
          clearTimeout(timeout);
          finish(true);
        });

        jumpClient.on("error", (err) => {
          clearTimeout(timeout);
          lastError = err;
          fileLogger.error(
            `Jump host ${i + 1}/${totalHops} connection failed`,
            err,
            {
              operation: "jump_host_connect",
              hostId: jumpHostConfig.id,
              ip: jumpHostConfig.ip,
              hopIndex: i,
              totalHops,
              previousHop:
                i > 0
                  ? jumpHostConfigs[i - 1]?.ip
                  : proxySocket
                    ? "proxy"
                    : "direct",
              usedProxySocket: i === 0 && !!proxySocket,
            },
          );
          finish(false);
        });

        const initialize = async () => {
          const connectConfig: Record<string, unknown> = {
            host:
              jumpHostConfig.ip?.replace(/^\[|\]$/g, "") || jumpHostConfig.ip,
            port: jumpHostConfig.port || 22,
            username: jumpHostConfig.username,
            tryKeyboard: !!interaction || jumpHostConfig.authType !== "none",
            readyTimeout: readyTimeoutMs,
            hostVerifier: jumpHostVerifier,
            algorithms: {
              kex: [
                "curve25519-sha256",
                "curve25519-sha256@libssh.org",
                "ecdh-sha2-nistp521",
                "ecdh-sha2-nistp384",
                "ecdh-sha2-nistp256",
                "diffie-hellman-group-exchange-sha256",
                "diffie-hellman-group18-sha512",
                "diffie-hellman-group17-sha512",
                "diffie-hellman-group16-sha512",
                "diffie-hellman-group15-sha512",
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
            },
          };

          if (
            jumpHostConfig.authType === "password" &&
            jumpHostConfig.password
          ) {
            connectConfig.password = jumpHostConfig.password;
          } else if (jumpHostConfig.authType === "key" && jumpHostConfig.key) {
            try {
              connectConfig.privateKey = preparePrivateKeyForSSH2(
                jumpHostConfig.key,
                jumpHostConfig.keyPassword,
              );
            } catch (keyError) {
              clearTimeout(timeout);
              lastError = new Error(
                `Jump host ${i + 1}/${totalHops} key error: ${getErrorMessage(keyError, "Invalid private key format")}`,
              );
              finish(false);
              return;
            }
            if (jumpHostConfig.keyPassword) {
              connectConfig.passphrase = jumpHostConfig.keyPassword;
            }
          } else if (jumpHostConfig.authType === "agent") {
            const result = await applyAgentAuth(
              connectConfig,
              jumpHostConfig.terminalConfig as
                Record<string, unknown> | undefined,
            );
            if ("error" in result) {
              throw new Error(result.error);
            }
          }

          const interactive = interaction
            ? attachInteractiveAuth(
                jumpClient,
                {
                  userId,
                  connectionId: randomUUID(),
                  channel: "jump",
                  hostId: jumpHostConfig.id,
                  address: jumpHostConfig.ip,
                  port: jumpHostConfig.port || 22,
                  username: jumpHostConfig.username,
                },
                {
                  signal,
                  onPrompt: interaction.onPrompt,
                  failure: (code) => {
                    lastError = Error(code);
                    finish(false);
                  },
                },
              )
            : undefined;
          jumpClient.on(
            "keyboard-interactive",
            (
              _name: string,
              _instructions: string,
              _lang: string,
              prompts: Array<{ prompt: string; echo: boolean }>,
              finish: (responses: string[]) => void,
            ) => {
              if (signal?.aborted) return;
              if (interactive) {
                interactive.handle(
                  _name,
                  _instructions,
                  prompts,
                  finish,
                  jumpHostConfig.authType !== "none"
                    ? jumpHostConfig.password
                    : undefined,
                );
                return;
              }
              const responses = prompts.map((p) => {
                if (/password/i.test(p.prompt) && jumpHostConfig.password) {
                  return jumpHostConfig.password as string;
                }
                return "";
              });
              finish(responses);
            },
          );

          signal?.throwIfAborted();
          if (settled) return;
          if (currentClient) {
            currentClient.forwardOut(
              "127.0.0.1",
              0,
              jumpHostConfig.ip,
              jumpHostConfig.port || 22,
              (err, stream) => {
                if (settled || signal?.aborted) {
                  stream?.destroy();
                  return;
                }
                if (err) {
                  clearTimeout(timeout);
                  lastError = err;
                  finish(false);
                  return;
                }
                connectConfig.sock = stream;
                jumpClient.connect(connectConfig);
              },
            );
          } else if (proxySocket) {
            connectConfig.sock = proxySocket;
            jumpClient.connect(connectConfig);
          } else {
            jumpClient.connect(connectConfig);
          }
        };
        void initialize().catch((error) => {
          lastError = error instanceof Error ? error : Error(String(error));
          finish(false);
          jumpClient.destroy();
        });
      });

      signal?.throwIfAborted();
      if (!connected) {
        clients.forEach((c) => c.end());
        throw new JumpHostChainError(
          getErrorMessage(
            lastError,
            `Jump host ${i + 1} of ${totalHops} failed to connect`,
          ),
          i,
          totalHops,
        );
      }

      currentClient = jumpClient;
    }

    if (currentClient)
      currentClient.once("close", () => {
        signal?.removeEventListener("abort", abort);
        abort();
      });
    return currentClient;
  } catch (error) {
    signal?.removeEventListener("abort", abort);
    abort();
    if (signal?.aborted) throw signal.reason;
    if (error instanceof JumpHostChainError) throw error;
    fileLogger.error("Failed to create jump host chain", error, {
      operation: "jump_host_chain",
    });
    clients.forEach((c) => c.end());
    return null;
  }
}

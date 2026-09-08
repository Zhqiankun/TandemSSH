import { captureAcceptedHostKey } from "./accepted-host-key.js";
import type { WebSocket } from "ws";
import type { Client } from "ssh2";
import { createCurrentHostResolutionRepository } from "../database/repositories/factory.js";
import { sshLogger } from "../utils/logger.js";
import { hostTrust } from "./trust/production.js";
import { hostFingerprint } from "./trust/fingerprint.js";
import type { HostTrustTarget } from "../../types/host-trust.js";
export class SSHHostKeyVerifier {
  static async preloadHostData(hostId: number | null) {
    if (!hostId) return null;
    return createCurrentHostResolutionRepository().findHostKeyVerificationData(
      hostId,
    );
  }
  static async createHostVerifier(
    hostId: number | null,
    ip: string,
    port: number,
    ws: WebSocket | null,
    userId: string,
    isJumpHost = false,
    preloadedHost?: Awaited<
      ReturnType<typeof SSHHostKeyVerifier.preloadHostData>
    >,
    client?: Client,
  ): Promise<(key: Buffer, verify: (valid: boolean) => void) => void> {
    const stop = new AbortController(),
      closed = () => stop.abort();
    ws?.once("close", closed);
    client?.once("close", closed);
    let accepted: string | undefined;
    const verifier = (input: Buffer, verify: (valid: boolean) => void) => {
      const key = Buffer.from(input);
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        verify(ok && !stop.signal.aborted);
      };
      const target: HostTrustTarget = {
        userId,
        address: ip,
        port,
        hostId: hostId || undefined,
        isJumpHost,
      };
      void (async () => {
        const actual = hostFingerprint(key);
        if (accepted && accepted !== actual.fingerprint) {
          hostTrust.report(target, Error("HOST_TRUST_RECONNECT_REQUIRED"));
          finish(false);
          return;
        }
        const legacy =
          preloadedHost !== undefined
            ? preloadedHost
            : await this.preloadHostData(hostId);
        if (hostId && !legacy) throw Error("HOST_TRUST_HOST_NOT_FOUND");
        target.hostname = legacy?.name ?? undefined;
        if (ws?.readyState === 1)
          ws.send(
            JSON.stringify({
              type: "host_trust_pending",
              data: { address: ip, port },
            }),
          );
        const allowed = await hostTrust.verify(target, key, {
          signal: stop.signal,
          legacy: legacy?.hostKeyFingerprint,
        });
        if (allowed) accepted = actual.fingerprint;
        finish(allowed);
      })().catch((error) => {
        const code =
          error instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.message)
            ? error.message
            : "HOST_TRUST_STORAGE_UNAVAILABLE";
        hostTrust.report(target, Error(code));
        sshLogger.error("SSH host trust verification refused", undefined, {
          operation: "host_trust_refused",
          hostId,
          ip,
          port,
          userId,
          code,
        });
        finish(false);
      });
    };
    return client ? captureAcceptedHostKey(client, verifier) : verifier;
  }
}

import { randomUUID } from "node:crypto";
import type {
  HostTrustDecision,
  HostTrustDecisionResult,
  HostTrustRecord,
  HostTrustRequest,
  HostTrustTarget,
} from "../../../types/host-trust.js";
import type { HostTrustStore } from "../../database/repositories/host-trust-repository.js";
import {
  hostAddress,
  hostFingerprint,
  hostTrustId,
  legacyFingerprint,
} from "./fingerprint.js";
interface Pending {
  view: HostTrustRequest;
  target: HostTrustTarget;
  recordId: string;
  dedup: string;
  waiters: Set<(ok: boolean) => void>;
  timer: ReturnType<typeof setTimeout>;
  approving: boolean;
}
interface Fault {
  id: string;
  address: string;
  port: number;
  code: string;
  expiresAt: number;
  userId: string;
}
export interface HostTrustPorts {
  store: HostTrustStore;
  audit(
    userId: string,
    type: string,
    data: Record<string, unknown>,
  ): Promise<void>;
}
export class HostTrustService {
  private readonly pending = new Map<string, Pending>();
  private readonly index = new Map<string, string>();
  private readonly faults: Fault[] = [];
  private readonly receipts = new Map<
    string,
    {
      userId: string;
      decision: string;
      result: HostTrustDecisionResult;
      expiresAt: number;
    }
  >();
  constructor(private readonly ports: HostTrustPorts) {}
  dispose() {
    for (const p of [...this.pending.values()]) this.settle(p, false);
    this.receipts.clear();
    this.faults.length = 0;
  }
  private settle(p: Pending, ok: boolean) {
    clearTimeout(p.timer);
    this.pending.delete(p.view.id);
    if (this.index.get(p.dedup) === p.view.id) this.index.delete(p.dedup);
    for (const finish of [...p.waiters]) finish(ok);
    p.waiters.clear();
  }
  private prune() {
    const now = Date.now();
    for (const [id, r] of this.receipts)
      if (r.expiresAt <= now) this.receipts.delete(id);
    for (let i = this.faults.length - 1; i >= 0; i--)
      if (this.faults[i].expiresAt <= now) this.faults.splice(i, 1);
  }
  report(target: HostTrustTarget, error: unknown) {
    this.prune();
    const code =
      error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "HOST_TRUST_STORAGE_UNAVAILABLE";
    if (
      !this.faults.some(
        (f) =>
          f.userId === target.userId &&
          f.address === target.address &&
          f.port === target.port &&
          f.code === code,
      )
    ) {
      if (this.faults.length >= 64) this.faults.shift();
      this.faults.push({
        id: randomUUID(),
        userId: target.userId,
        address: target.address,
        port: target.port,
        code,
        expiresAt: Date.now() + 300000,
      });
    }
  }
  list(userId: string) {
    this.prune();
    return {
      requests: [...this.pending.values()]
        .filter((p) => p.target.userId === userId)
        .map((p) => structuredClone(p.view)),
      errors: this.faults
        .filter((f) => f.userId === userId)
        .map(({ userId: _owner, ...f }) => ({ ...f })),
    };
  }
  async verify(
    input: HostTrustTarget,
    key: Buffer,
    options: { signal?: AbortSignal; legacy?: string | null } = {},
  ): Promise<boolean> {
    const target = { ...input, address: hostAddress(input.address) },
      recordId = hostTrustId(
        target.userId,
        target.address,
        target.port,
        target.hostId,
      ),
      actual = hostFingerprint(Buffer.from(key));
    if (options.signal?.aborted) return false;
    let record: HostTrustRecord | undefined;
    try {
      record = await this.ports.store.get(recordId, target.userId);
    } catch (error) {
      this.report(target, error);
      throw error;
    }
    if (options.signal?.aborted) return false;
    if (record) {
      if (
        record.id !== recordId ||
        record.userId !== target.userId ||
        record.profileScope !==
          (target.hostId ? "host:" + target.hostId : "quick") ||
        record.address !== target.address ||
        record.port !== target.port ||
        !/^SHA256:[A-Za-z0-9+/]{43}$/.test(record.fingerprint) ||
        !Number.isInteger(record.revision) ||
        record.revision < 1
      )
        throw Error("HOST_TRUST_RECORD_INVALID");
      if (
        record.fingerprint === actual.fingerprint &&
        record.keyType === actual.keyType
      )
        return true;
    }
    const old = record?.fingerprint ?? legacyFingerprint(options.legacy),
      changed = !!record || (!!old && old !== actual.fingerprint);
    const dedup = JSON.stringify([
        recordId,
        record?.revision ?? 0,
        actual.fingerprint,
      ]),
      existing = this.index.get(dedup);
    let p = existing ? this.pending.get(existing) : undefined;
    if (!p) {
      if (
        this.pending.size >= 128 ||
        [...this.pending.values()].filter(
          (p) => p.target.userId === target.userId,
        ).length >= 32
      )
        throw Error("HOST_TRUST_REQUEST_LIMIT");
      const now = Date.now(),
        view: HostTrustRequest = {
          id: randomUUID(),
          address: target.address,
          port: target.port,
          hostId: target.hostId,
          hostname: target.hostname,
          isJumpHost: target.isJumpHost,
          scenario: changed ? "changed" : options.legacy ? "legacy" : "new",
          fingerprint: actual.fingerprint,
          keyType: actual.keyType,
          oldFingerprint: old,
          expectedRevision: record?.revision ?? 0,
          createdAt: now,
          expiresAt: now + (changed ? 300000 : 45000),
          connectionStopped: changed,
        };
      p = {
        view,
        target,
        recordId,
        dedup,
        waiters: new Set(),
        timer: undefined as unknown as ReturnType<typeof setTimeout>,
        approving: false,
      };
      const request = p;
      p.timer = setTimeout(
        () => this.settle(request, false),
        view.expiresAt - now,
      );
      p.timer.unref?.();
      this.pending.set(view.id, p);
      this.index.set(dedup, view.id);
    }
    if (changed) return false;
    if (p.waiters.size >= 64) throw Error("HOST_TRUST_REQUEST_LIMIT");
    const pending = p;
    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        options.signal?.removeEventListener("abort", abort);
        pending.waiters.delete(finish);
        resolve(ok);
      };
      const abort = () => {
        finish(false);
        if (!pending.waiters.size && !pending.approving)
          this.settle(pending, false);
      };
      pending.waiters.add(finish);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  }
  async decide(
    userId: string,
    input: HostTrustDecision,
  ): Promise<HostTrustDecisionResult> {
    this.prune();
    const digest = JSON.stringify(input),
      receipt = this.receipts.get(input.requestId);
    if (receipt) {
      if (receipt.userId !== userId || receipt.decision !== digest)
        throw Error("HOST_TRUST_DECISION_STALE");
      return structuredClone(receipt.result);
    }
    const p = this.pending.get(input.requestId);
    if (!p || p.target.userId !== userId)
      throw Error("HOST_TRUST_REQUEST_NOT_FOUND");
    if (p.view.expiresAt <= Date.now())
      throw Error("HOST_TRUST_REQUEST_EXPIRED");
    if (
      p.view.fingerprint !== input.fingerprint ||
      p.view.expectedRevision !== input.expectedRevision
    )
      throw Error("HOST_TRUST_DECISION_STALE");
    if (p.approving) throw Error("HOST_TRUST_DECISION_IN_PROGRESS");
    if (!["trust", "reject"].includes(input.action))
      throw Error("HOST_TRUST_DECISION_STALE");
    if (input.action === "trust" && input.verified !== true)
      throw Error("HOST_TRUST_VERIFICATION_REQUIRED");
    p.approving = true;
    try {
      if (input.action === "trust") {
        await this.ports.audit(userId, "host.trust.intent", {
          requestId: p.view.id,
          address: p.view.address,
          port: p.view.port,
          fingerprint: p.view.fingerprint,
          scenario: p.view.scenario,
          expectedRevision: p.view.expectedRevision,
        });
        if (!this.pending.has(p.view.id) || p.view.expiresAt <= Date.now())
          throw Error("HOST_TRUST_REQUEST_EXPIRED");
        const record: HostTrustRecord = {
          id: p.recordId,
          userId,
          profileScope: p.target.hostId ? "host:" + p.target.hostId : "quick",
          address: p.view.address,
          port: p.view.port,
          fingerprint: p.view.fingerprint,
          keyType: p.view.keyType,
          revision: p.view.expectedRevision + 1,
          approvedAt: new Date().toISOString(),
        };
        await this.ports.store.compareAndSet(record, p.view.expectedRevision);
      }
      const reconnect =
        p.view.connectionStopped ||
        p.view.expiresAt <= Date.now() ||
        !p.waiters.size;
      this.settle(p, input.action === "trust" && !reconnect);
      const result: HostTrustDecisionResult = {
        requestId: p.view.id,
        status: input.action === "trust" ? "trusted" : "rejected",
        reconnectRequired: input.action === "trust" && reconnect,
      };
      if (this.receipts.size >= 256)
        this.receipts.delete(this.receipts.keys().next().value!);
      this.receipts.set(p.view.id, {
        userId,
        decision: digest,
        result,
        expiresAt: Date.now() + 300000,
      });
      await this.ports
        .audit(userId, "host.trust.decision", {
          ...result,
          address: p.view.address,
          port: p.view.port,
          fingerprint: p.view.fingerprint,
        })
        .catch((error) => this.report(p.target, error));
      return structuredClone(result);
    } catch (error) {
      this.settle(p, false);
      this.report(p.target, error);
      throw error;
    }
  }
}

import { and, eq } from "drizzle-orm";
import { hostTrustRecords } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import type { HostTrustRecord } from "../../../types/host-trust.js";
import { rowsAffected } from "./mutation-result.js";
interface Barrier {
  tail: Promise<unknown>;
  failed: boolean;
}
const barriers = new WeakMap<object, Barrier>();
export interface HostTrustStore {
  get(id: string, userId: string): Promise<HostTrustRecord | undefined>;
  compareAndSet(next: HostTrustRecord, expectedRevision: number): Promise<void>;
}
export class HostTrustRepository implements HostTrustStore {
  private readonly barrier: Barrier;
  constructor(
    private readonly context: DatabaseContext,
    private readonly persist?: () => Promise<void>,
  ) {
    let b = barriers.get(context.drizzle);
    if (!b) {
      b = { tail: Promise.resolve(), failed: false };
      barriers.set(context.drizzle, b);
    }
    this.barrier = b;
  }
  private serial<T>(fn: () => Promise<T>) {
    const run = async () => {
      if (this.barrier.failed) throw Error("HOST_TRUST_STORAGE_UNAVAILABLE");
      return fn();
    };
    const pending = this.barrier.tail.then(run, run);
    this.barrier.tail = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }
  get(id: string, userId: string) {
    return this.serial(async () => {
      const rows = await this.context.drizzle
        .select()
        .from(hostTrustRecords)
        .where(
          and(eq(hostTrustRecords.id, id), eq(hostTrustRecords.userId, userId)),
        )
        .limit(1);
      return rows[0];
    });
  }
  compareAndSet(next: HostTrustRecord, expectedRevision: number) {
    return this.serial(async () => {
      if (next.revision !== expectedRevision + 1)
        throw Error("HOST_TRUST_RECORD_CHANGED");
      const db = this.context.drizzle,
        existing = (
          await db
            .select()
            .from(hostTrustRecords)
            .where(eq(hostTrustRecords.id, next.id))
            .limit(1)
        )[0];
      if (
        (existing?.revision ?? 0) !== expectedRevision ||
        (existing && existing.userId !== next.userId)
      )
        throw Error("HOST_TRUST_RECORD_CHANGED");

      if (expectedRevision === 0) {
        try {
          await db.insert(hostTrustRecords).values(next);
        } catch (error) {
          const current = (
            await db
              .select()
              .from(hostTrustRecords)
              .where(eq(hostTrustRecords.id, next.id))
              .limit(1)
          )[0];
          if (current) throw Error("HOST_TRUST_RECORD_CHANGED");
          throw error;
        }
      } else {
        const changed = await db
          .update(hostTrustRecords)
          .set(next)
          .where(
            and(
              eq(hostTrustRecords.id, next.id),
              eq(hostTrustRecords.userId, next.userId),
              eq(hostTrustRecords.revision, expectedRevision),
            ),
          );
        if (rowsAffected(changed) !== 1)
          throw Error("HOST_TRUST_RECORD_CHANGED");
      }

      try {
        await this.persist?.();
      } catch (error) {
        this.barrier.failed = true;
        // Keep all reads closed after a failed durability barrier. Rollback is best effort;
        // a later process must reload the durable database rather than trust this memory.
        try {
          if (existing)
            await db
              .update(hostTrustRecords)
              .set(existing)
              .where(
                and(
                  eq(hostTrustRecords.id, next.id),
                  eq(hostTrustRecords.revision, next.revision),
                ),
              );
          else
            await db
              .delete(hostTrustRecords)
              .where(
                and(
                  eq(hostTrustRecords.id, next.id),
                  eq(hostTrustRecords.revision, next.revision),
                ),
              );
        } catch {
          /* Poisoned barrier prevents using an uncertain in-memory value. */
        }
        throw Error("HOST_TRUST_STORAGE_UNAVAILABLE", { cause: error });
      }
    });
  }
}

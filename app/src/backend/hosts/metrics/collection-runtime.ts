import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import type { Client, ClientChannel } from "ssh2";
import type {
  MonitoringAction,
  MonitoringBatch,
  MonitoringSnapshot,
} from "../../../types/monitoring.js";
import {
  MONITORING_COMMANDS,
  monitoringCommand,
  type MonitoringCommandId,
} from "./collection-catalog.js";

export interface CollectionSettings {
  metricsEnabled: boolean;
  metricsInterval: number;
  enabledWidgets: readonly string[];
}
interface CollectionState {
  paused: boolean;
  active?: CollectionScope;
  recent: MonitoringBatch[];
}
interface CollectionScope {
  runtime: MonitoringCollectionRuntime;
  hostId: number;
  userId: string;
  settings: CollectionSettings;
  controller: AbortController;
  batch: MonitoringBatch;
  bytes: number;
  running: number;
  waiters: Array<() => void>;
  executions: Set<Promise<unknown>>;
}
interface CommandOutput {
  stdout: string;
  stderr: string;
  code: number | null;
}
const collectionContext = new AsyncLocalStorage<CollectionScope>();
const keyFor = (hostId: number, userId: string) =>
  JSON.stringify([hostId, userId]);
const errorCode = (error: unknown) =>
  error instanceof Error && /^MONITORING_[A-Z_]+$/.test(error.message)
    ? error.message
    : "MONITORING_FAILED";

function cancellable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}

/** Owns metric collection only. Interactive terminal and manager commands do not enter this runtime. */
export class MonitoringCollectionRuntime {
  private readonly states = new Map<string, CollectionState>();
  constructor(
    private readonly deps: {
      authorize: (hostId: number, userId: string) => Promise<void>;
      audit: (userId: string, type: string, data: unknown) => Promise<void>;
      batchTimeoutMs?: number;
      commandOutputLimit?: number;
    },
  ) {}
  private state(hostId: number, userId: string): CollectionState {
    if (
      !Number.isSafeInteger(hostId) ||
      hostId < 1 ||
      !userId ||
      userId.length > 256
    )
      throw Error("MONITORING_IDENTITY_INVALID");
    const key = keyFor(hostId, userId);
    let state = this.states.get(key);
    if (!state) {
      if (this.states.size >= 256) {
        const idle = [...this.states.entries()].find(
          ([, value]) => !value.active && !value.paused,
        );
        if (!idle) throw Error("MONITORING_CAPACITY");
        this.states.delete(idle[0]);
      }
      state = { paused: false, recent: [] };
      this.states.set(key, state);
    }
    return state;
  }
  snapshot(
    hostId: number,
    userId: string,
    settings: CollectionSettings,
  ): MonitoringSnapshot {
    const state = this.state(hostId, userId);
    return structuredClone({
      hostId,
      paused: state.paused,
      intervalSeconds: settings.metricsInterval,
      metricsEnabled: settings.metricsEnabled,
      commands: MONITORING_COMMANDS.filter((c) =>
        settings.enabledWidgets.includes(c.widget),
      ),
      current: state.active?.batch,
      recent: state.recent,
    });
  }
  isPaused(hostId: number, userId: string): boolean {
    return this.states.get(keyFor(hostId, userId))?.paused ?? false;
  }
  pause(hostId: number, userId: string): void {
    const state = this.state(hostId, userId);
    state.paused = true;
    state.active?.controller.abort(Error("MONITORING_CANCELLED"));
  }
  resume(hostId: number, userId: string): void {
    this.state(hostId, userId).paused = false;
  }
  cancelHost(hostId: number): void {
    for (const state of this.states.values())
      if (state.active?.hostId === hostId)
        state.active.controller.abort(Error("MONITORING_CANCELLED"));
  }
  async run<T>(
    hostId: number,
    userId: string,
    settings: CollectionSettings,
    collect: () => Promise<T>,
  ): Promise<T> {
    const state = this.state(hostId, userId);
    if (!settings.metricsEnabled) throw Error("MONITORING_DISABLED");
    if (state.paused) throw Error("MONITORING_PAUSED");
    if (state.active) throw Error("MONITORING_BUSY");
    const scope: CollectionScope = {
      runtime: this,
      hostId,
      userId,
      settings,
      controller: new AbortController(),
      batch: {
        id: randomUUID(),
        hostId,
        startedAt: Date.now(),
        status: "running",
        actions: [],
      },
      bytes: 0,
      running: 0,
      waiters: [],
      executions: new Set(),
    };
    state.active = scope;
    const timer = setTimeout(
      () => scope.controller.abort(Error("MONITORING_TIMEOUT")),
      this.deps.batchTimeoutMs ?? 45000,
    );
    try {
      await cancellable(
        this.deps.authorize(hostId, userId),
        scope.controller.signal,
      );
      scope.controller.signal.throwIfAborted();
      await this.deps.audit(userId, "monitoring.collection-start", {
        hostId,
        batchId: scope.batch.id,
        intervalSeconds: settings.metricsInterval,
        widgets: settings.enabledWidgets,
      });
      scope.controller.signal.throwIfAborted();
      const result = await new Promise<T>((resolve, reject) => {
        const abort = () => reject(scope.controller.signal.reason);
        scope.controller.signal.addEventListener("abort", abort, {
          once: true,
        });
        const work = collectionContext.run(scope, collect);
        work
          .then(resolve, reject)
          .finally(() =>
            scope.controller.signal.removeEventListener("abort", abort),
          );
        if (scope.controller.signal.aborted) abort();
      });
      scope.controller.signal.throwIfAborted();
      scope.batch.status = scope.batch.actions.some(
        (a) => a.status !== "completed",
      )
        ? "partial"
        : "completed";
      return result;
    } catch (error) {
      scope.batch.errorCode = errorCode(error);
      scope.batch.status =
        scope.batch.errorCode === "MONITORING_CANCELLED"
          ? "cancelled"
          : "failed";
      throw error;
    } finally {
      clearTimeout(timer);
      scope.controller.abort(Error("MONITORING_CANCELLED"));
      await Promise.allSettled([...scope.executions]);
      scope.batch.finishedAt = Date.now();
      state.recent.unshift(structuredClone(scope.batch));
      state.recent.length = Math.min(state.recent.length, 20);
      if (state.active === scope) state.active = undefined;
      await this.deps.audit(
        userId,
        "monitoring.collection-result",
        scope.batch,
      );
    }
  }
  async execute(
    scope: CollectionScope,
    client: Client,
    id: MonitoringCommandId,
    args?: { path: string },
  ): Promise<CommandOutput> {
    const command = monitoringCommand(id, args),
      signal = scope.controller.signal;
    signal.throwIfAborted();
    if (!scope.settings.enabledWidgets.includes(command.widget))
      throw Error("MONITORING_WIDGET_DISABLED");
    if (scope.batch.actions.length >= 64) {
      scope.controller.abort(Error("MONITORING_COMMAND_LIMIT"));
      throw Error("MONITORING_COMMAND_LIMIT");
    }
    const action: MonitoringAction = {
      commandId: id,
      command: command.command,
      startedAt: Date.now(),
      status: "running",
      outputBytes: 0,
    };
    scope.batch.actions.push(action);
    let acquired = false;
    try {
      if (scope.running >= 4)
        await new Promise<void>((resolve, reject) => {
          const ready = () => {
            scope.running++;
            acquired = true;
            signal.removeEventListener("abort", abort);
            resolve();
          };
          const abort = () => {
            scope.waiters = scope.waiters.filter((w) => w !== ready);
            reject(signal.reason);
          };
          scope.waiters.push(ready);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
      if (!acquired) {
        scope.running++;
        acquired = true;
      }
      signal.throwIfAborted();
      await cancellable(
        this.deps.authorize(scope.hostId, scope.userId),
        signal,
      );
      signal.throwIfAborted();
      const output = await this.exec(
        client,
        command.command,
        command.timeoutMs,
        scope,
        action,
      );
      action.exitCode = output.code;
      action.status = output.code === 0 ? "completed" : "unavailable";
      return output;
    } catch (error) {
      const code = errorCode(error);
      action.status =
        code === "MONITORING_DENIED"
          ? "denied"
          : code === "MONITORING_TIMEOUT"
            ? "timeout"
            : code === "MONITORING_OUTPUT_LIMIT"
              ? "output-limit"
              : signal.aborted
                ? "cancelled"
                : "failed";
      throw error;
    } finally {
      action.finishedAt = Date.now();
      if (acquired) {
        scope.running--;
        scope.waiters.shift()?.();
      }
    }
  }
  private exec(
    client: Client,
    command: string,
    timeoutMs: number,
    scope: CollectionScope,
    action: MonitoringAction,
  ): Promise<CommandOutput> {
    const signal = scope.controller.signal;
    return new Promise((resolve, reject) => {
      let settled = false,
        stream: ClientChannel | undefined,
        stdout = "",
        stderr = "";
      const outDecoder = new StringDecoder("utf8"),
        errDecoder = new StringDecoder("utf8");
      const finish = (error?: unknown, code?: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        client.off("close", closed);
        stream?.destroy();
        if (error) reject(error);
        else
          resolve({
            stdout: stdout + outDecoder.end(),
            stderr: stderr + errDecoder.end(),
            code: typeof code === "number" ? code : null,
          });
      };
      const abort = () =>
        finish(signal.reason ?? Error("MONITORING_CANCELLED"));
      const closed = () => finish(Error("MONITORING_CONNECTION_CLOSED"));
      const timer = setTimeout(
        () => finish(Error("MONITORING_TIMEOUT")),
        timeoutMs,
      );
      signal.addEventListener("abort", abort, { once: true });
      client.once("close", closed);
      if (signal.aborted) {
        abort();
        return;
      }
      try {
        client.exec(command, { pty: false }, (error, channel) => {
          if (settled) {
            channel?.destroy();
            return;
          }
          if (error) {
            finish(error);
            return;
          }
          stream = channel;
          const data = (chunk: Buffer, isError: boolean) => {
            if (settled) return;
            action.outputBytes += chunk.length;
            scope.bytes += chunk.length;
            if (
              action.outputBytes >
                (this.deps.commandOutputLimit ?? 1024 * 1024) ||
              scope.bytes > 4 * 1024 * 1024
            ) {
              scope.controller.abort(Error("MONITORING_OUTPUT_LIMIT"));
              return;
            }
            if (isError) stderr += errDecoder.write(chunk);
            else stdout += outDecoder.write(chunk);
          };
          channel.on("data", (chunk) => data(Buffer.from(chunk), false));
          channel.stderr.on("data", (chunk) => data(Buffer.from(chunk), true));
          channel.on("error", (error) => finish(error));
          channel.stderr.on("error", (error) => finish(error));
          channel.once("close", (code: number) => finish(undefined, code));
        });
      } catch (error) {
        finish(error);
      }
    });
  }
}

export function execMetricCommand(
  client: Client,
  id: MonitoringCommandId,
  args?: { path: string },
): Promise<CommandOutput> {
  const scope = collectionContext.getStore();
  if (!scope) return Promise.reject(Error("MONITORING_CONTEXT_REQUIRED"));
  const work = scope.runtime.execute(scope, client, id, args);
  scope.executions.add(work);
  void work.finally(() => scope.executions.delete(work)).catch(() => {});
  return work;
}

export function assertMonitoringCollectionActive(): void {
  const scope = collectionContext.getStore();
  if (!scope) throw Error("MONITORING_CONTEXT_REQUIRED");
  scope.controller.signal.throwIfAborted();
}

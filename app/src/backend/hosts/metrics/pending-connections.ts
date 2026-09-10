export interface PendingMonitoringConnection {
  readonly signal: AbortSignal;
  own(close: () => void): void;
  waitForAuthentication(timeoutMs?: number): void;
  complete(): void;
  cancel(reason?: Error): void;
}
interface Entry {
  hostId: number;
  userId: string;
  viewerId: string;
  background: boolean;
  connection: PendingMonitoringConnection;
}
/** Only owns monitoring handshakes; completed clients belong to MetricsSession. */
export class PendingMonitoringConnections {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly timeoutMs = 60000) {}
  begin(
    hostId: number,
    userId: string,
    viewerId: string,
    background = false,
  ): PendingMonitoringConnection {
    if (
      !Number.isSafeInteger(hostId) ||
      hostId < 1 ||
      !userId ||
      userId.length > 256 ||
      !/^[a-zA-Z0-9:._-]{1,128}$/.test(viewerId)
    )
      throw Error("MONITORING_IDENTITY_INVALID");
    if (this.entries.has(viewerId)) throw Error("MONITORING_CONNECTION_BUSY");
    if (this.entries.size >= 256) throw Error("MONITORING_CAPACITY");
    const controller = new AbortController(),
      resources = new Set<() => void>();
    let finished = false;
    const remove = () => {
      clearTimeout(timer);
      if (this.entries.get(viewerId)?.connection === connection)
        this.entries.delete(viewerId);
    };
    const connection: PendingMonitoringConnection = {
      signal: controller.signal,
      own: (close) => {
        if (controller.signal.aborted) {
          close();
          controller.signal.throwIfAborted();
        }
        if (finished) throw Error("MONITORING_CONNECTION_FINISHED");
        resources.add(close);
      },
      waitForAuthentication: (timeoutMs = 180000) => {
        if (
          !Number.isSafeInteger(timeoutMs) ||
          timeoutMs < 1 ||
          timeoutMs > 300000
        )
          throw Error("MONITORING_TIMEOUT_INVALID");
        if (finished) return;
        clearTimeout(timer);
        timer = setTimeout(
          () => connection.cancel(Error("MONITORING_TIMEOUT")),
          timeoutMs,
        );
      },
      complete: () => {
        if (finished) return;
        finished = true;
        remove();
        resources.clear();
      },
      cancel: (reason = Error("MONITORING_CANCELLED")) => {
        if (finished) return;
        finished = true;
        remove();
        controller.abort(reason);
        for (const close of resources) {
          try {
            close();
          } catch {
            /* shutdown is best effort */
          }
        }
        resources.clear();
      },
    };
    let timer = setTimeout(
      () => connection.cancel(Error("MONITORING_TIMEOUT")),
      this.timeoutMs,
    );
    this.entries.set(viewerId, {
      hostId,
      userId,
      viewerId,
      background,
      connection,
    });
    return connection;
  }
  owns(hostId: number, userId: string, viewerId: string): boolean {
    const entry = this.entries.get(viewerId);
    return entry?.hostId === hostId && entry.userId === userId;
  }
  cancel(hostId: number, userId: string, viewerId?: string): void {
    for (const entry of this.entries.values())
      if (
        entry.hostId === hostId &&
        entry.userId === userId &&
        (!viewerId || entry.viewerId === viewerId)
      )
        entry.connection.cancel();
  }
  cancelBackground(hostId: number): void {
    for (const entry of this.entries.values())
      if (entry.hostId === hostId && entry.background)
        entry.connection.cancel();
  }
  complete(hostId: number, userId: string, viewerId: string): void {
    if (this.owns(hostId, userId, viewerId))
      this.entries.get(viewerId)?.connection.complete();
  }
}
export const pendingMonitoringConnections = new PendingMonitoringConnections();

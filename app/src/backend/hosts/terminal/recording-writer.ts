import type { RecordingFailure } from "../../../types/terminal-recording.js";
interface RecordingWriterOptions {
  write(chunk: string, first: boolean): Promise<void>;
  failed(reason: RecordingFailure): void;
  committed?(bytes: number): void;
  maxPendingBytes?: number;
  maxPendingItems?: number;
  flushDelayMs?: number;
  writeTimeoutMs?: number;
}
/** At most one storage operation and a bounded backlog; payloads never form a promise chain. */
export class RecordingWriter {
  private readonly maxBytes: number;
  private readonly maxItems: number;
  private readonly delay: number;
  private readonly timeout: number;
  private queue: string[] = [];
  private queuedBytes = 0;
  private activeBytes = 0;
  private activeItems = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private closed = false;
  private completion: Promise<void> = Promise.resolve();
  private complete: () => void = () => {};
  private stopped: RecordingFailure | null = null;
  private accepted = 0;
  private saved = 0;
  constructor(private readonly options: RecordingWriterOptions) {
    this.maxBytes = options.maxPendingBytes ?? 4 * 1024 * 1024;
    this.maxItems = options.maxPendingItems ?? 4096;
    this.delay = options.flushDelayMs ?? 300;
    this.timeout = options.writeTimeoutMs ?? 15000;
    if (
      ![this.maxBytes, this.maxItems, this.delay, this.timeout].every(
        (n) => Number.isSafeInteger(n) && n > 0,
      )
    )
      throw Error("RECORDING_CONFIG_INVALID");
  }
  get failure() {
    return this.stopped;
  }
  get acceptedBytes() {
    return this.accepted;
  }
  get committedBytes() {
    return this.saved;
  }
  snapshot() {
    return {
      pendingBytes: this.queuedBytes + this.activeBytes,
      pendingItems: this.queue.length + this.activeItems,
      writing: this.running,
      closed: this.closed,
      failure: this.stopped,
      committedBytes: this.saved,
    };
  }
  append(line: string): boolean {
    if (this.closed || this.stopped) return false;
    if (!line) return true;
    const bytes = Buffer.byteLength(line);
    if (
      this.queuedBytes + this.activeBytes + bytes > this.maxBytes ||
      this.queue.length + this.activeItems >= this.maxItems
    ) {
      this.fail("capacity");
      return false;
    }
    this.queue.push(line);
    this.queuedBytes += bytes;
    this.accepted += bytes;
    this.schedule();
    return true;
  }
  private schedule() {
    if (this.running || this.timer || this.stopped || !this.queue.length)
      return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.delay);
    this.timer.unref?.();
  }
  private fail(reason: RecordingFailure) {
    if (this.stopped) return;
    this.stopped = reason;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.queue = [];
    this.queuedBytes = 0;
    this.complete();
    try {
      this.options.failed(reason);
    } catch {
      /* failure reporting must not restart writes */
    }
  }
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.running || this.stopped) return this.completion;
    if (!this.queue.length) return Promise.resolve();
    this.running = true;
    let done!: () => void;
    this.completion = new Promise((resolve) => {
      done = resolve;
    });
    this.complete = done;
    void Promise.resolve()
      .then(async () => {
        while (this.queue.length && !this.stopped) {
          const batch = this.queue;
          this.queue = [];
          const bytes = this.queuedBytes;
          this.queuedBytes = 0;
          this.activeBytes = bytes;
          this.activeItems = batch.length;
          const timeout = setTimeout(
            () => this.fail("write-timeout"),
            this.timeout,
          );
          timeout.unref?.();
          try {
            await this.options.write(batch.join(""), this.saved === 0);
            this.saved += bytes;
            try {
              this.options.committed?.(bytes);
            } catch {
              /* observer only */
            }
          } catch {
            this.fail("write-failed");
          } finally {
            clearTimeout(timeout);
            this.activeBytes = 0;
            this.activeItems = 0;
          }
        }
      })
      .catch(() => this.fail("write-failed"))
      .finally(() => {
        this.running = false;
        done();
        this.schedule();
      });
    return this.completion;
  }
  close(): Promise<void> {
    this.closed = true;
    return this.flush();
  }
}

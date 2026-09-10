import type { ServerResponse } from "node:http";
/** One chat's awaited delivery; a slow client cannot grow an unbounded write queue. */
export class ChatDelivery {
  private bytes = 0;
  constructor(
    private readonly response: ServerResponse,
    private readonly abort: AbortController,
  ) {}
  async send(event: unknown): Promise<void> {
    this.abort.signal.throwIfAborted();
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    const size = Buffer.byteLength(frame);
    if (
      size > 256 * 1024 ||
      this.bytes + size > 4 * 1024 * 1024 ||
      this.response.writableLength > 256 * 1024
    ) {
      const error = Error("MODEL_RESPONSE_TOO_LARGE");
      this.abort.abort(error);
      this.response.destroy();
      throw error;
    }
    this.bytes += size;
    if (this.response.write(frame)) return;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.response.off("drain", drained);
        this.abort.signal.removeEventListener("abort", stopped);
        error ? reject(error) : resolve();
      };
      const drained = () => finish();
      const stopped = () => finish(Error("MODEL_STREAM_INTERRUPTED"));
      const timer = setTimeout(() => {
        const error = Error("MODEL_RESPONSE_TIMEOUT");
        finish(error);
        this.abort.abort(error);
        this.response.destroy();
      }, 15000);
      timer.unref?.();
      this.response.once("drain", drained);
      this.abort.signal.addEventListener("abort", stopped, { once: true });
      if (this.abort.signal.aborted) stopped();
    });
  }
}

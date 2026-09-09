import { randomUUID } from "node:crypto";
import type { NativeUploadSelection } from "../../types/upload-source.js";
import type { LocalBridgeTransport } from "./local-file-bridge.js";
export interface UploadBatchSourcePort {
  snapshot(
    token: string,
    sourceId: string,
  ): Promise<{ snapshot: string; selection: NativeUploadSelection }>;
  restore(
    token: string,
    sourceId: string,
    snapshot: string,
  ): Promise<NativeUploadSelection>;
  forget(token: string, sourceId: string): Promise<unknown>;
}
export class UploadBatchNativeClient implements UploadBatchSourcePort {
  constructor(
    private transport: LocalBridgeTransport,
    private available: () => boolean,
  ) {}
  private request<T>(
    token: string,
    sourceId: string,
    method: string,
    snapshot?: string,
  ): Promise<T> {
    if (!this.available())
      return Promise.reject(Error("UPLOAD_BATCH_DESKTOP_REQUIRED"));
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      let done = false;
      const finish = (error?: Error, value?: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.transport.removeListener("message", message);
        this.transport.removeListener("disconnect", disconnect);
        if (error) reject(error);
        else resolve(value as T);
      };
      const message = (raw?: unknown) => {
        if (!raw || typeof raw !== "object") return;
        const r = raw as {
          type?: string;
          requestId?: string;
          ok?: boolean;
          error?: string;
          value?: unknown;
        };
        if (
          r.type !== "tandem-upload-batch-source-response" ||
          r.requestId !== requestId
        )
          return;
        if (r.ok) finish(undefined, r.value);
        else
          finish(
            Error(
              typeof r.error === "string" && /^[A-Z][A-Z0-9_]+$/.test(r.error)
                ? r.error
                : "UPLOAD_BATCH_SOURCE_FAILED",
            ),
          );
      };
      const disconnect = () => finish(Error("UPLOAD_BATCH_DESKTOP_REQUIRED")),
        timer = setTimeout(() => finish(Error("UPLOAD_BATCH_TIMEOUT")), 30000);
      this.transport.on("message", message);
      this.transport.on("disconnect", disconnect);
      try {
        this.transport.send(
          {
            type: "tandem-upload-batch-source-request",
            requestId,
            windowToken: token,
            sourceId,
            method,
            ...(snapshot === undefined ? {} : { snapshot }),
          },
          (e) => {
            if (e) finish(e);
          },
        );
      } catch {
        disconnect();
      }
    });
  }
  snapshot(token: string, sourceId: string) {
    return this.request<{ snapshot: string; selection: NativeUploadSelection }>(
      token,
      sourceId,
      "snapshot",
    );
  }
  restore(token: string, sourceId: string, snapshot: string) {
    return this.request<NativeUploadSelection>(
      token,
      sourceId,
      "restore",
      snapshot,
    );
  }
  forget(token: string, sourceId: string) {
    return this.request(token, sourceId, "forget");
  }
}

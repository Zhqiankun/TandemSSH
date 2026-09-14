import { expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
const { createC2SUploadPump } = createRequire(import.meta.url)("../electron/c2s-upload-pump.cjs");
it("pauses before ready and admits only one write until its callback finishes", async () => {
  const input = [Buffer.from("中文"), Buffer.from([0, 1, 255]), Buffer.from("tail")];
  const socket = Readable.from(input);
  const callbacks: Array<(error?: Error) => void> = [];
  const sent: Buffer[] = [];
  const failure = vi.fn();
  const pump = createC2SUploadPump(socket, { send: (chunk: Buffer, done: (e?: Error) => void) => { sent.push(chunk); callbacks.push(done); } }, failure);
  try {
    await new Promise(r => setTimeout(r, 20));
    expect(sent).toEqual([]);
    expect(socket.readableFlowing).toBe(false);
    pump.start(Buffer.from("prefix"));
    expect(sent).toEqual([Buffer.from("prefix")]);
    for (let i = 0; i < input.length; i++) {
      callbacks.shift()!();
      await vi.waitFor(() => expect(sent).toHaveLength(i + 2));
      expect(socket.readableFlowing).toBe(false);
      expect(callbacks).toHaveLength(1);
    }
    callbacks.shift()!();
    expect(Buffer.concat(sent)).toEqual(Buffer.concat([Buffer.from("prefix"), ...input]));
    expect(failure).not.toHaveBeenCalled();
  } finally { pump.close(); socket.destroy(); }
});
it("does not resume a cancelled socket when an old send callback arrives", async () => {
  const socket = Readable.from([Buffer.from("later")]);
  let complete!: (error?: Error) => void;
  const send = vi.fn((_data, cb) => { complete = cb; });
  const pump = createC2SUploadPump(socket, { send }, vi.fn());
  pump.start(Buffer.from("first"));
  pump.close();
  complete();
  await new Promise(r => setTimeout(r, 20));
  expect(send).toHaveBeenCalledTimes(1);
  expect(socket.readableFlowing).toBe(false);
  socket.destroy();
});
it("reports write failure without resuming input", () => {
  const socket = Readable.from([]), error = Error("write failed"), failed = vi.fn();
  const pump = createC2SUploadPump(socket, { send: (_data: Buffer, done: (e: Error) => void) => done(error) }, failed);
  pump.start(Buffer.from("first"));
  expect(failed).toHaveBeenCalledWith(error);
  expect(socket.readableFlowing).toBe(false);
  pump.close(); socket.destroy();
});

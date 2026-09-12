import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ChannelOpenSerializer,
  execWithSudoBuffer,
  type SSHSession,
} from "../../../hosts/file-manager/session.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function fixture() {
  const stream = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    end: vi.fn(),
    destroy: vi.fn(),
  });
  let opened!: (error: undefined, stream: unknown) => void;
  const exec = vi.fn((_command: string, callback: typeof opened) => {
    opened = callback;
  });
  const session = {
    client: { exec },
    isConnected: true,
    channelOpener: new ChannelOpenSerializer(),
  } as unknown as SSHSession;
  return { stream, exec, session, open: () => opened(undefined, stream) };
}
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

it("expires a queued sudo command before dispatch without sending a password", async () => {
  const f = fixture();
  let release!: () => void;
  const held = f.session.channelOpener.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const pending = execWithSudoBuffer(f.session, "id -u", "secret");
  await vi.advanceTimersByTimeAsync(60000);
  expect(await pending).toMatchObject({
    code: null,
    stderr: "SUDO_NOT_DISPATCHED",
  });
  release();
  await held;
  await flush();
  expect(f.exec).not.toHaveBeenCalled();
  expect(f.stream.end).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([false, true])(
  "expires an unresponsive sudo request (channel already opened=%s)",
  async (opened) => {
    const f = fixture();
    const pending = execWithSudoBuffer(f.session, "id -u", "secret");
    await flush();
    expect(f.exec).toHaveBeenCalledTimes(1);
    if (opened) {
      f.open();
      await flush();
      f.stream.emit("data", Buffer.from("partial"));
    }
    await vi.advanceTimersByTimeAsync(60000);
    expect(await pending).toMatchObject({
      code: null,
      stderr: "SUDO_RESULT_UNKNOWN",
    });
    if (!opened) {
      f.open();
      await flush();
    }
    expect(f.stream.destroy).toHaveBeenCalledTimes(1);
    expect(f.stream.end).toHaveBeenCalledTimes(opened ? 1 : 0);
    f.stream.emit("close", 0);
    expect((await pending).code).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it.each(["disconnected", "replaced"] as const)(
  "rejects a queued request when its session is %s",
  async (reason) => {
    const f = fixture();
    let release!: () => void,
      current = true;
    const held = f.session.channelOpener.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = execWithSudoBuffer(f.session, "id -u", "secret", () => {
      if (!current) throw Error("SUDO_NOT_DISPATCHED");
    });
    await flush();
    if (reason === "disconnected") f.session.isConnected = false;
    else current = false;
    release();
    await held;
    await flush();
    expect(await pending).toMatchObject({ stderr: "SUDO_NOT_DISPATCHED" });
    expect(f.exec).not.toHaveBeenCalled();
    expect(f.stream.end).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("does not send a password after connection loss during channel negotiation", async () => {
  const f = fixture();
  const pending = execWithSudoBuffer(f.session, "id -u", "secret");
  await flush();
  f.session.isConnected = false;
  f.open();
  await flush();
  expect(await pending).toMatchObject({
    code: null,
    stderr: "SUDO_RESULT_UNKNOWN",
  });
  expect(f.stream.end).not.toHaveBeenCalled();
  expect(f.stream.destroy).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("clears the timeout after confirmed completion", async () => {
  const f = fixture();
  const pending = execWithSudoBuffer(f.session, "id -u", "secret");
  await flush();
  f.open();
  await flush();
  f.stream.emit("data", Buffer.from("0\n"));
  f.stream.emit("close", 0);
  expect(await pending).toMatchObject({ code: 0, stdout: Buffer.from("0\n") });
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60000);
  expect(f.stream.destroy).not.toHaveBeenCalled();
});

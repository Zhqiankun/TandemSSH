import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import {
  ChannelOpenSerializer,
  execWithSudoBuffer,
  type SSHSession,
} from "../../../hosts/file-manager/session.js";
it.each([undefined, null, 0, 1, 126])(
  "preserves sudo exit status %s without turning an absent status into success",
  async (code) => {
    const stream = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
    });
    const session = {
      client: {
        exec: vi.fn((_command, callback) => callback(undefined, stream)),
      },
      channelOpener: new ChannelOpenSerializer(),
      isConnected: true,
      lastActive: 0,
      activeOperations: 0,
    } as unknown as SSHSession;
    const pending = execWithSudoBuffer(session, "false", "fixture-password");
    await vi.waitFor(() => expect(stream.listenerCount("close")).toBe(1));
    stream.emit("data", Buffer.from("read-only filesystem"));
    stream.emit("close", code);
    const result = await pending;
    expect(result.code).toBe(code == null ? null : code);
  },
);

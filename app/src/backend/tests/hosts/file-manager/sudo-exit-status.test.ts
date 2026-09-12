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
      end: vi.fn(),
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
    expect(session.client.exec).toHaveBeenCalledWith(
      "sudo -S -p '' -- false",
      expect.any(Function),
    );
    expect(stream.end).toHaveBeenCalledExactlyOnceWith("fixture-password\n");
    expect(
      JSON.stringify(vi.mocked(session.client.exec).mock.calls),
    ).not.toContain("fixture-password");
    const output = Buffer.from(
      "[sudo] password for user: literal file content\0",
    );
    stream.emit("data", output);
    stream.stderr.emit("data", Buffer.from("sudo diagnostic"));
    stream.emit("close", code);
    const result = await pending;
    expect(result.code).toBe(code == null ? null : code);
    expect(result.stdout).toEqual(output);
    expect(result.stderr).toBe("sudo diagnostic");
  },
);

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// Stub all external imports before loading the module under test
const mockCreate = vi.fn().mockResolvedValue({ id: 1 });
const mockUpdateEnded = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../database/db/index.js", () => ({
  getDb: () => ({}),
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSessionRecordingRepository: () => ({
    create: mockCreate,
    updateEnded: mockUpdateEnded,
  }),
}));

vi.mock("../../../utils/logger.js", () => ({
  sshLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock individual fs.promises methods via a stub object
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockAppendFile = vi.fn().mockResolvedValue(undefined);
const mockUnlink = vi.fn().mockResolvedValue(undefined);

vi.mock("fs", () => ({
  default: {
    promises: {
      mkdir: mockMkdir,
      writeFile: mockWriteFile,
      appendFile: mockAppendFile,
      readFile: vi.fn(),
      unlink: mockUnlink,
    },
  },
  promises: {
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
    appendFile: mockAppendFile,
    readFile: vi.fn(),
    unlink: mockUnlink,
  },
}));

const { sessionManager, isMessageAllowedForParticipant } =
  await import("../../../hosts/terminal/session-manager.js");

// Minimal fake WebSocket - only the surface session-manager touches.
function makeFakeWs(readyState = 1 /* OPEN */) {
  return Object.assign(new EventEmitter(), {
    readyState,
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
  }) as unknown as import("ws").WebSocket;
}
const WS_OPEN = 1;
const WS_CLOSED = 3;

describe("TandemSSH control adapter", () => {
  it("manual input revokes automation and writes exactly once to the existing SSH stream", () => {
    const id = sessionManager.createSession(
      "owner",
      1,
      "fixture",
      80,
      24,
      undefined,
      false,
    );
    const ws = makeFakeWs();
    const stream = { write: vi.fn(), end: vi.fn(), destroyed: false };
    try {
      sessionManager.setSSHState(
        id,
        { end: vi.fn() } as never,
        stream as never,
      );
      expect(sessionManager.attachWs(id, "owner", ws)).not.toBeNull();
      const session = sessionManager.getSession(id)!;
      const lease = session.control.grant(
        { kind: "automation", ownerType: "agent-task", ownerId: "task" },
        session.control.snapshot(),
      );
      sessionManager.sendHumanInput(id, ws, "人工接管\r");
      expect(stream.write).toHaveBeenCalledOnce();
      expect(stream.write.mock.calls[0][0].toString("utf8")).toBe("人工接管\r");
      expect(() =>
        session.control.commitWrite(lease, Buffer.from("late")),
      ).toThrowError("STALE_CONTROL");
      expect(stream.write).toHaveBeenCalledOnce();
    } finally {
      sessionManager.destroySession(id);
    }
  });

  it("unknown sockets and read-only participants cannot use the manual input route", () => {
    const id = sessionManager.createSession(
      "owner",
      1,
      "fixture",
      80,
      24,
      undefined,
      false,
    );
    const stream = { write: vi.fn(), end: vi.fn(), destroyed: false };
    const guest = makeFakeWs();
    try {
      sessionManager.setSSHState(
        id,
        { end: vi.fn() } as never,
        stream as never,
      );
      sessionManager.joinAsParticipant(id, guest, {
        userId: null,
        permissionLevel: "read-only",
      });
      expect(() =>
        sessionManager.sendHumanInput(id, guest, "blocked"),
      ).toThrowError("CONTROL_BUSY");
      expect(() =>
        sessionManager.sendHumanInput(id, makeFakeWs(), "unregistered"),
      ).toThrowError("CONTROL_BUSY");
      expect(stream.write).not.toHaveBeenCalled();
    } finally {
      sessionManager.destroySession(id);
    }
  });

  it("replacing an SSH channel invalidates the old lease before accepting writes", () => {
    const id = sessionManager.createSession(
      "owner",
      1,
      "fixture",
      80,
      24,
      undefined,
      false,
    );
    const first = { write: vi.fn(), end: vi.fn(), destroyed: false };
    const second = { write: vi.fn(), end: vi.fn(), destroyed: false };
    try {
      sessionManager.setSSHState(id, { end: vi.fn() } as never, first as never);
      const control = sessionManager.getSession(id)!.control;
      const lease = control.grant(
        { kind: "automation", ownerType: "workflow-run", ownerId: "flow" },
        control.snapshot(),
      );
      sessionManager.setSSHState(
        id,
        { end: vi.fn() } as never,
        second as never,
      );
      expect(() =>
        control.commitWrite(lease, Buffer.from("stale")),
      ).toThrowError("STALE_CONTROL");
      expect(first.write).not.toHaveBeenCalled();
      expect(second.write).not.toHaveBeenCalled();
    } finally {
      sessionManager.destroySession(id);
    }
  });
});

describe("TerminalSessionManager - session logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply resolved values after clearAllMocks
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue({ id: 1 });
    mockUpdateEnded.mockResolvedValue(undefined);
  });

  it("createSession leaves full terminal recording disabled by default", () => {
    const id = sessionManager.createSession("u1", 1, "host", 80, 24);
    const session = sessionManager.getSession(id);
    expect(session?.sessionLoggingEnabled).toBe(false);
    sessionManager.destroySession(id);
  });

  it("createSession stores sessionLoggingEnabled=false when passed", () => {
    const id = sessionManager.createSession(
      "u1",
      1,
      "host",
      80,
      24,
      undefined,
      false,
    );
    const session = sessionManager.getSession(id);
    expect(session?.sessionLoggingEnabled).toBe(false);
    sessionManager.destroySession(id);
  });

  it("does not write log file when sessionLoggingEnabled=false", async () => {
    const id = sessionManager.createSession(
      "u1",
      1,
      "host",
      80,
      24,
      undefined,
      false,
    );
    sessionManager.bufferOutput(id, "some output");
    sessionManager.destroySession(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("writes log file and inserts DB row when sessionLoggingEnabled=true", async () => {
    const id = sessionManager.createSession(
      "u1",
      1,
      "host",
      80,
      24,
      undefined,
      true,
    );
    sessionManager.bufferOutput(id, "terminal output data");
    sessionManager.destroySession(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockWriteFile).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("does not write log file when buffer is empty", async () => {
    const id = sessionManager.createSession(
      "u1",
      1,
      "host",
      80,
      24,
      undefined,
      true,
    );
    sessionManager.destroySession(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("bufferOutput trims old data when exceeding 512KB", () => {
    const id = sessionManager.createSession(
      "u1",
      1,
      "host",
      80,
      24,
      undefined,
      false,
    );
    const chunk = "x".repeat(300 * 1024);
    sessionManager.bufferOutput(id, chunk);
    sessionManager.bufferOutput(id, chunk);
    const session = sessionManager.getSession(id);
    expect(session!.outputBufferBytes).toBeLessThanOrEqual(512 * 1024);
    sessionManager.destroySession(id);
  });
});

describe("TerminalSessionManager - multiplayer participants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue({ id: 1 });
    mockUpdateEnded.mockResolvedValue(undefined);
  });

  function createConnectedSession(): string {
    const id = sessionManager.createSession(
      "owner-1",
      1,
      "host",
      80,
      24,
      undefined,
      false,
    );
    // Mark connected without a real ssh2 stream - only isConnected is read
    // by attachWs/joinAsParticipant.
    const session = sessionManager.getSession(id)!;
    session.isConnected = true;
    return id;
  }

  it("joinAsParticipant adds a participant without evicting the owner", () => {
    const id = createConnectedSession();
    const ownerWs = makeFakeWs();
    sessionManager.attachWs(id, "owner-1", ownerWs);

    const guestWs = makeFakeWs();
    const session = sessionManager.joinAsParticipant(id, guestWs, {
      userId: null,
      permissionLevel: "read-only",
      guestLabel: "Guest",
    });

    expect(session).not.toBeNull();
    expect(session!.participants.size).toBe(2);
    const ownerParticipant = sessionManager.getParticipantForWs(
      session!,
      ownerWs,
    );
    expect(ownerParticipant?.isOwner).toBe(true);
    expect(ownerWs.send).not.toHaveBeenCalled();

    sessionManager.destroySession(id);
  });

  it("joinAsParticipant returns null for a nonexistent or unconnected session", () => {
    expect(
      sessionManager.joinAsParticipant("does-not-exist", makeFakeWs(), {
        userId: null,
        permissionLevel: "read-only",
      }),
    ).toBeNull();
  });

  it("broadcast sends to all OPEN participant sockets and skips CLOSED ones", () => {
    const id = createConnectedSession();
    const ownerWs = makeFakeWs(WS_OPEN);
    sessionManager.attachWs(id, "owner-1", ownerWs);

    const openGuestWs = makeFakeWs(WS_OPEN);
    const closedGuestWs = makeFakeWs(WS_CLOSED);
    sessionManager.joinAsParticipant(id, openGuestWs, {
      userId: null,
      permissionLevel: "read-only",
    });
    sessionManager.joinAsParticipant(id, closedGuestWs, {
      userId: null,
      permissionLevel: "read-only",
    });

    sessionManager.broadcast(id, { type: "data", data: "hello" });

    expect(ownerWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "data", data: "hello" }),
      expect.any(Function),
    );
    expect(openGuestWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "data", data: "hello" }),
      expect.any(Function),
    );
    expect(closedGuestWs.send).not.toHaveBeenCalled();

    sessionManager.destroySession(id);
  });

  it("broadcast does not throw if a socket's send throws", () => {
    const id = createConnectedSession();
    const throwingWs = makeFakeWs(WS_OPEN);
    (throwingWs.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("send failed");
    });
    sessionManager.attachWs(id, "owner-1", throwingWs);

    expect(() =>
      sessionManager.broadcast(id, { type: "data", data: "x" }),
    ).not.toThrow();

    sessionManager.destroySession(id);
  });

  it("broadcast is a no-op for a nonexistent session", () => {
    expect(() =>
      sessionManager.broadcast("does-not-exist", { type: "data" }),
    ).not.toThrow();
  });

  it("owner detach arms the idle timeout (existing behavior)", () => {
    vi.useFakeTimers();
    try {
      const id = createConnectedSession();
      const ownerWs = makeFakeWs();
      sessionManager.attachWs(id, "owner-1", ownerWs);

      sessionManager.detachWs(id);
      const session = sessionManager.getSession(id);
      expect(session?.detachTimeout).not.toBeNull();
      expect(session?.lastDetachedAt).not.toBeNull();

      sessionManager.destroySession(id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removeParticipant on a non-owner does not arm a timeout or destroy the session", () => {
    const id = createConnectedSession();
    const ownerWs = makeFakeWs();
    sessionManager.attachWs(id, "owner-1", ownerWs);

    const guestWs = makeFakeWs();
    sessionManager.joinAsParticipant(id, guestWs, {
      userId: null,
      permissionLevel: "read-write",
    });

    sessionManager.removeParticipant(id, guestWs);

    const session = sessionManager.getSession(id);
    expect(session).not.toBeNull();
    expect(session?.detachTimeout).toBeNull();
    expect(session?.participants.size).toBe(1);
    expect(sessionManager.getParticipantForWs(session!, guestWs)).toBeNull();

    sessionManager.destroySession(id);
  });

  it("removeParticipant is a no-op when the ws belongs to the owner", () => {
    const id = createConnectedSession();
    const ownerWs = makeFakeWs();
    sessionManager.attachWs(id, "owner-1", ownerWs);

    sessionManager.removeParticipant(id, ownerWs);

    const session = sessionManager.getSession(id);
    expect(session?.participants.size).toBe(1);
    expect(sessionManager.getParticipantForWs(session!, ownerWs)?.isOwner).toBe(
      true,
    );

    sessionManager.destroySession(id);
  });

  it("destroySession cleans up all participants, not just the owner", () => {
    const id = createConnectedSession();
    const ownerWs = makeFakeWs();
    sessionManager.attachWs(id, "owner-1", ownerWs);

    const guestWs = makeFakeWs();
    sessionManager.joinAsParticipant(id, guestWs, {
      userId: null,
      permissionLevel: "read-only",
    });

    sessionManager.destroySession(id);

    expect(guestWs.send).toHaveBeenCalled();
    expect(sessionManager.getSession(id)).toBeNull();
  });

  it("ownerEndSession notifies non-owner participants and destroys the session", () => {
    const id = createConnectedSession();
    const ownerWs = makeFakeWs();
    sessionManager.attachWs(id, "owner-1", ownerWs);

    const guestWs = makeFakeWs();
    sessionManager.joinAsParticipant(id, guestWs, {
      userId: null,
      permissionLevel: "read-write",
    });

    sessionManager.ownerEndSession(id, "owner ended the session");

    expect(guestWs.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "sessionTerminatedByOwner",
        reason: "owner ended the session",
      }),
      expect.any(Function),
    );
    expect(sessionManager.getSession(id)).toBeNull();
  });
});

describe("isMessageAllowedForParticipant", () => {
  it("allows any message type for the owner or when there is no participant", () => {
    expect(isMessageAllowedForParticipant(null, "connectToHost")).toBe(true);
    expect(
      isMessageAllowedForParticipant(
        { isOwner: true, permissionLevel: "read-write" },
        "resize",
      ),
    ).toBe(true);
  });

  it("drops input from a read-only participant", () => {
    expect(
      isMessageAllowedForParticipant(
        { isOwner: false, permissionLevel: "read-only" },
        "input",
      ),
    ).toBe(false);
  });

  it("allows input from a read-write non-owner participant", () => {
    expect(
      isMessageAllowedForParticipant(
        { isOwner: false, permissionLevel: "read-write" },
        "input",
      ),
    ).toBe(true);
  });

  it("allows ping and disconnect for any non-owner participant", () => {
    expect(
      isMessageAllowedForParticipant(
        { isOwner: false, permissionLevel: "read-only" },
        "ping",
      ),
    ).toBe(true);
    expect(
      isMessageAllowedForParticipant(
        { isOwner: false, permissionLevel: "read-only" },
        "disconnect",
      ),
    ).toBe(true);
  });

  it("blocks resize and auth/tmux message types for non-owner participants regardless of permission level", () => {
    for (const type of [
      "resize",
      "totp_response",
      "password_response",
      "tmux_attach",
      "tmux_detach",
      "get_cwd",
      "vault_start_auth",
      "opkssh_start_auth",
    ]) {
      expect(
        isMessageAllowedForParticipant(
          { isOwner: false, permissionLevel: "read-write" },
          type,
        ),
      ).toBe(false);
    }
  });
});

it("only accepts expected protocol replies from the current writable display owner", () => {
  const id = sessionManager.createSession("owner", 1, "fixture", 80, 24),
    owner = makeFakeWs(),
    reader = makeFakeWs(),
    writer = makeFakeWs(),
    stream = { write: vi.fn(), end: vi.fn(), destroyed: false };
  try {
    sessionManager.setSSHState(id, { end: vi.fn() } as never, stream as never);
    sessionManager.attachWs(id, "owner", owner);
    sessionManager.joinAsParticipant(id, reader, {
      userId: "reader",
      permissionLevel: "read-only",
    });
    sessionManager.joinAsParticipant(id, writer, {
      userId: "writer",
      permissionLevel: "read-write",
    });
    const control = sessionManager.getSession(id)!.control,
      lease = control.grant(
        { kind: "automation", ownerType: "mcp-client", ownerId: "fixture" },
        control.snapshot(),
      );
    sessionManager.bufferOutput(id, "\x1b[6n");
    for (const ws of [reader, writer, makeFakeWs()])
      expect(sessionManager.sendTerminalReply(id, ws, "\x1b[1;1R")).toBe(false);
    expect(sessionManager.sendTerminalReply(id, owner, "touch file\r")).toBe(
      false,
    );
    expect(stream.write).not.toHaveBeenCalled();
    expect(sessionManager.sendTerminalReply(id, owner, "\x1b[1;1R")).toBe(true);
    expect(() => control.assertLease(lease)).not.toThrow();
    expect(stream.write).toHaveBeenCalledOnce();
  } finally {
    sessionManager.destroySession(id);
  }
});
it("allows an existing writable participant to answer when the owner is detached, but never a read-only participant", () => {
  const id = sessionManager.createSession("owner", 1, "fixture", 80, 24),
    writer = makeFakeWs(),
    stream = { write: vi.fn(), end: vi.fn(), destroyed: false };
  try {
    sessionManager.setSSHState(id, { end: vi.fn() } as never, stream as never);
    sessionManager.joinAsParticipant(id, writer, {
      userId: "writer",
      permissionLevel: "read-write",
    });
    sessionManager.bufferOutput(id, "\x1b[6n");
    expect(sessionManager.sendTerminalReply(id, writer, "\x1b[1;1R")).toBe(
      true,
    );
    expect(
      isMessageAllowedForParticipant(
        { isOwner: false, permissionLevel: "read-only" },
        "terminal-reply",
      ),
    ).toBe(false);
    expect(
      isMessageAllowedForParticipant(
        { isOwner: false, permissionLevel: "read-write" },
        "terminal-reply",
      ),
    ).toBe(true);
  } finally {
    sessionManager.destroySession(id);
  }
});

describe("terminal output capacity and control", () => {
  it("bounds UTF-8 history bytes and tiny chunk counts with explicit truncation", () => {
    const id = sessionManager.createSession(
      "history-owner",
      1,
      "fixture",
      80,
      24,
    );
    try {
      sessionManager.bufferOutput(id, "界".repeat(100000));
      sessionManager.bufferOutput(id, "界".repeat(100000));
      const session = sessionManager.getSession(id)!;
      expect(session.outputBufferBytes).toBe(300000);
      expect(sessionManager.getOutputSnapshot(session)).toMatchObject({
        cursor: 2,
        firstCursor: 1,
        truncated: true,
      });
      for (let i = 0; i < 5000; i++) sessionManager.bufferOutput(id, "x");
      expect(session.outputBuffer.length).toBeLessThanOrEqual(4096);
      expect(
        Buffer.byteLength(sessionManager.getOutputSnapshot(session).text),
      ).toBeLessThanOrEqual(512 * 1024);
    } finally {
      sessionManager.destroySession(id);
    }
  });
  it.each([true, false])(
    "isolates an overflowing participant (owner=%s)",
    (ownerOverflows) => {
      const id = sessionManager.createSession(
        "delivery-owner",
        1,
        "fixture",
        80,
        24,
      );
      const owner = makeFakeWs(),
        guest = makeFakeWs();
      try {
        const session = sessionManager.getSession(id)!;
        session.isConnected = true;
        session.sshStream = {
          destroyed: false,
          write: vi.fn(),
          end: vi.fn(),
        } as unknown as import("ssh2").ClientChannel;
        sessionManager.attachWs(id, "delivery-owner", owner);
        sessionManager.joinAsParticipant(id, guest, {
          userId: null,
          permissionLevel: "read-only",
        });
        const lease = session.control.grant(
          { kind: "automation", ownerType: "agent-task", ownerId: "task" },
          session.control.snapshot(),
        );
        const slow = ownerOverflows ? owner : guest;
        Object.defineProperty(slow, "bufferedAmount", {
          value: 4 * 1024 * 1024,
        });
        sessionManager.broadcast(id, { type: "data", data: "new output" });
        expect(slow.close).toHaveBeenCalledWith(
          1013,
          "TERMINAL_OUTPUT_OVERFLOW",
        );
        if (ownerOverflows) {
          expect(() =>
            session.control.commitWrite(lease, Buffer.from("late write")),
          ).toThrow("STALE_CONTROL");
          expect(sessionManager.getOutputSnapshot(session).truncated).toBe(
            true,
          );
        } else {
          expect(() => session.control.assertLease(lease)).not.toThrow();
          expect(sessionManager.getOutputSnapshot(session).truncated).toBe(
            false,
          );
        }
        const replay = makeFakeWs();
        sessionManager.replayOutput(session, replay);
        if (ownerOverflows)
          expect(
            vi
              .mocked(replay.send)
              .mock.calls.some(
                (c) => JSON.parse(c[0] as string).type === "context.gap",
              ),
          ).toBe(true);
        (slow as unknown as EventEmitter).emit("close");
      } finally {
        sessionManager.destroySession(id);
      }
    },
  );
});

describe("recording failure and automated input", () => {
  it("revokes automation before a capacity-failing input is handed to SSH, while manual input remains usable", async () => {
    const id = sessionManager.createSession(
      "record-owner",
      1,
      "fixture",
      80,
      24,
      undefined,
      true,
    );
    const ws = makeFakeWs(),
      stream = { destroyed: false, write: vi.fn(), end: vi.fn() };
    const session = sessionManager.getSession(id)!;
    try {
      sessionManager.setSSHState(
        id,
        { end: vi.fn() } as never,
        stream as never,
      );
      sessionManager.attachWs(id, "record-owner", ws);
      const lease = session.control.grant(
        { kind: "automation", ownerType: "agent-task", ownerId: "task" },
        session.control.snapshot(),
      );
      sessionManager.bufferOutput(id, "P".repeat(4 * 1024 * 1024 - 1000));
      expect(() =>
        session.control.commitWrite(lease, Buffer.from("x".repeat(2048))),
      ).toThrow();
      expect(stream.write).not.toHaveBeenCalled();
      expect(session.recordingFailure).toBe("capacity");
      expect(session.control.snapshot().controller.kind).toBe("human");
      sessionManager.sendHumanInput(id, ws, "manual\r");
      expect(stream.write).toHaveBeenCalledOnce();
      expect(stream.write.mock.calls[0][0].toString()).toBe("manual\r");
      await session.recordingPersistChain;
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          terminationReason: "recording-stopped:capacity",
        }),
      );
    } finally {
      sessionManager.destroySession(id);
      await session.recordingPersistChain;
    }
  });
  it("marks a failed write as incomplete and leaves terminal history intact", async () => {
    mockWriteFile.mockRejectedValueOnce(Error("fixture disk error"));
    const id = sessionManager.createSession(
        "record-error",
        1,
        "fixture",
        80,
        24,
        undefined,
        true,
      ),
      session = sessionManager.getSession(id)!;
    try {
      sessionManager.bufferOutput(id, "live output");
      await session.recordingWriter!.flush();
      await session.recordingPersistChain;
      expect(session.recordingBytes).toBe(0);
      expect(session.recordingFailure).toBe("write-failed");
      expect(sessionManager.getOutputSnapshot(session)).toMatchObject({
        text: "live output",
        truncated: false,
        recordingFailure: "write-failed",
      });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          terminationReason: "recording-stopped:write-failed",
        }),
      );
    } finally {
      sessionManager.destroySession(id);
      await session.recordingPersistChain;
    }
  });
  it("coalesces repeated metadata requests while a database write is pending", async () => {
    let release!: (value: { id: number }) => void;
    mockCreate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const id = sessionManager.createSession(
        "record-meta",
        1,
        "fixture",
        80,
        24,
        undefined,
        true,
      ),
      session = sessionManager.getSession(id)!;
    try {
      sessionManager.bufferOutput(id, "first");
      await session.recordingWriter!.flush();
      sessionManager.detachWs(id);
      await vi.waitFor(() => expect(release).toBeDefined());
      const work = session.recordingPersistChain;
      sessionManager.bufferOutput(id, "second");
      await session.recordingWriter!.flush();
      for (let i = 0; i < 100; i++) sessionManager.detachWs(id);
      expect(session.recordingPersistChain).toBe(work);
      release({ id: 55 });
      await work;
      expect(session.recordingPersistRunning).toBe(false);
      expect(session.lastPersistedBytes).toBe(session.recordingBytes);
    } finally {
      sessionManager.destroySession(id);
      await session.recordingPersistChain;
    }
  });
});

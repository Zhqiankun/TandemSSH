import { describe, expect, it } from "vitest";
import {
  SessionControl,
  ControlError,
} from "../../collaboration/sessions/control.js";
import type { ControlChangedEvent } from "../../../types/collaboration.js";

const bytes = (text: string) => new TextEncoder().encode(text);
function fixture(id = "session-a") {
  const writes: string[] = [];
  const events: ControlChangedEvent[] = [];
  const control = new SessionControl(
    id,
    {
      isReady: () => true,
      write: (data) => {
        writes.push(new TextDecoder().decode(data));
      },
    },
    (event) => {
      events.push(event);
    },
  );
  const grant = () =>
    control.grant(
      { kind: "automation", ownerType: "agent-task", ownerId: "task-a" },
      control.snapshot(),
    );
  return { control, writes, events, grant };
}

describe("shared terminal control", () => {
  it("revokes queued and late actions after takeover returns", async () => {
    const { control, writes, grant } = fixture();
    const lease = grant();
    let finishPreparation!: () => void;
    const preparing = new Promise<void>((resolve) => {
      finishPreparation = resolve;
    });
    const late = preparing.then(() =>
      control.commitWrite(lease, bytes("late\r")),
    );
    const rejection = expect(late).rejects.toMatchObject({
      code: "STALE_CONTROL",
    });
    control.takeover();
    control.humanInput(bytes("manual\r"));
    finishPreparation();
    await rejection;
    expect(writes).toEqual(["manual\r"]);
  });

  it("keeps already dispatched bytes visible without claiming rollback", () => {
    const { control, writes, grant } = fixture();
    control.commitWrite(grant(), bytes("started\r"));
    control.takeover();
    expect(writes).toEqual(["started\r"]);
  });

  it("manual input takes control of the same stream before writing", () => {
    const { control, writes, grant, events } = fixture();
    const lease = grant();
    control.commitWrite(lease, bytes("pwd\r"));
    control.humanInput(bytes("\u0003"));
    expect(() => control.commitWrite(lease, bytes("next\r"))).toThrow(
      ControlError,
    );
    expect(writes).toEqual(["pwd\r", "\u0003"]);
    expect(events.at(-1)?.state.controller.kind).toBe("human");
  });

  it("never resurrects an old lease when control is returned to the same task", () => {
    const { control, grant } = fixture();
    const old = grant();
    control.takeover();
    const current = grant();
    expect(current.controlEpoch).toBeGreaterThan(old.controlEpoch);
    expect(() => control.commitWrite(old, bytes("old"))).toThrow(ControlError);
    control.commitWrite(current, bytes("new"));
  });

  it("rejects cross-session, wrong-owner and stale-grant requests", () => {
    const a = fixture();
    const b = fixture("session-b");
    const lease = a.grant();
    b.grant();
    expect(() => b.control.commitWrite(lease, bytes("wrong target"))).toThrow(
      ControlError,
    );
    expect(() =>
      a.control.commitWrite(
        { ...lease, ownerId: "task-b" },
        bytes("wrong task"),
      ),
    ).toThrow(ControlError);
    expect(() => a.grant()).toThrowError("CONTROL_BUSY");
    a.control.takeover();
    expect(() =>
      a.control.grant(
        { kind: "automation", ownerId: "task-a", ownerType: "agent-task" },
        { generation: 1, controlEpoch: 0 },
      ),
    ).toThrowError("STALE_CONTROL");
  });

  it("reconnection and close invalidate pending writes", () => {
    const { control, grant, writes } = fixture();
    const old = grant();
    control.connectionChanged();
    expect(() => control.commitWrite(old, bytes("old connection"))).toThrow(
      ControlError,
    );
    const current = grant();
    control.close();
    expect(() => control.commitWrite(current, bytes("closed"))).toThrowError(
      "SESSION_CLOSED",
    );
    expect(() => control.humanInput(bytes("closed"))).toThrowError(
      "SESSION_CLOSED",
    );
    expect(writes).toEqual([]);
  });

  it("does not retry an uncertain transport write and revokes automation", () => {
    let attempts = 0;
    const control = new SessionControl(
      "s",
      {
        isReady: () => true,
        write: () => {
          attempts++;
          throw new Error("connection lost");
        },
      },
      () => {},
    );
    const lease = control.grant(
      { kind: "automation", ownerId: "t", ownerType: "workflow-run" },
      control.snapshot(),
    );
    expect(() => control.commitWrite(lease, bytes("side effect"))).toThrowError(
      "RESULT_UNKNOWN",
    );
    expect(attempts).toBe(1);
    expect(control.snapshot().controller.kind).toBe("human");
  });

  it("protects state from caller mutation and observer failure", () => {
    const { control, grant } = fixture();
    const lease = grant();
    const snapshot = control.snapshot();
    snapshot.controlEpoch = 0;
    snapshot.controller = { kind: "human" };
    expect(control.snapshot().controlEpoch).toBe(lease.controlEpoch);
    const isolated = new SessionControl(
      "s",
      { isReady: () => true, write: () => {} },
      () => {
        throw new Error("renderer gone");
      },
    );
    expect(isolated.takeover().controller.kind).toBe("human");
  });

  it("rejects invalid and excessive raw input before any write", () => {
    const { control, writes } = fixture();
    expect(() => control.humanInput(bytes(""))).toThrowError("INVALID_INPUT");
    expect(() => control.humanInput(new Uint8Array(65537))).toThrowError(
      "INVALID_INPUT",
    );
    expect(writes).toEqual([]);
  });
});

it("answers requested terminal protocol messages without changing the automation lease", () => {
  const { control, writes, grant } = fixture(),
    lease = grant(),
    before = control.snapshot();
  control.observeTerminalOutput("\x1b[6n");
  expect(control.terminalReply(bytes("\x1b[24;17R"))).toBe(true);
  expect(control.snapshot()).toEqual(before);
  expect(() => control.assertLease(lease)).not.toThrow();
  expect(writes).toEqual(["\x1b[24;17R"]);
  expect(control.terminalReply(bytes("\x1b[24;17R"))).toBe(false);
});
it("still treats a user-entered cursor-shaped sequence as human input and clears old query replies", () => {
  const { control, writes, grant } = fixture(),
    lease = grant();
  control.observeTerminalOutput("\x1b[6n");
  control.humanInput(bytes("\x1b[1;2R"));
  expect(() => control.assertLease(lease)).toThrow("STALE_CONTROL");
  expect(control.terminalReply(bytes("\x1b[24;17R"))).toBe(false);
  expect(writes).toEqual(["\x1b[1;2R"]);
});
it("does not let old connection replies survive reconnect or close", () => {
  const { control, writes } = fixture();
  control.observeTerminalOutput("\x1b[6n");
  control.connectionChanged();
  expect(control.terminalReply(bytes("\x1b[2;3R"))).toBe(false);
  control.observeTerminalOutput("\x1b[6n");
  control.close();
  expect(control.terminalReply(bytes("\x1b[2;3R"))).toBe(false);
  expect(writes).toEqual([]);
});

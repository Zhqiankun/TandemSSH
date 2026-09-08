import { describe, expect, it, vi } from "vitest";
import { SessionControl } from "../../collaboration/sessions/control.js";
import {
  OperationGateway,
  type CommandExecutorPort,
  type OperationAuditPort,
  type OperationContext,
} from "../../collaboration/operations/gateway.js";
import { evaluateCommandPolicy } from "../../collaboration/policies/command-policy.js";
import type {
  CommandAction,
  CommandPolicySnapshot,
} from "../../../types/collaboration-operations.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const action = (
  program = "df",
  args = ["-h"],
  cwd = "/srv/app",
): CommandAction => ({ type: "terminal.command", program, args, cwd });
function fixture(
  options: {
    mode?: OperationContext["mode"];
    executor?: CommandExecutorPort;
    audit?: OperationAuditPort;
    now?: () => number;
  } = {},
) {
  const writes: string[] = [];
  const events: string[] = [];
  const control = new SessionControl(
    "session-1",
    {
      isReady: () => true,
      write: (data) => {
        writes.push(Buffer.from(data).toString());
      },
    },
    () => {},
  );
  const lease = control.grant(
    { kind: "automation", ownerType: "agent-task", ownerId: "task-1" },
    control.snapshot(),
  );
  const policy: CommandPolicySnapshot = {
    revision: 1,
    sets: [
      {
        id: "global",
        scope: { type: "global" },
        strictAllowlist: false,
        rules: [
          {
            id: "allow-df",
            effect: "allow",
            match: { kind: "program", program: "df" },
            reason: "磁盘检查",
          },
        ],
      },
    ],
  };
  const context = (requestId: string): OperationContext => ({
    requestId,
    taskId: "task-1",
    mode: options.mode ?? "automatic",
    origin: "agent",
    lease,
  });
  const gateway = new OperationGateway(
    control,
    { hostId: "host-1", groupIds: ["production"] },
    () => policy,
    options.executor ?? {
      prepare: async (command) => ({
        bytes: Buffer.from([command.program, ...command.args].join(" ")),
        completion: Promise.resolve({ exitCode: 0, output: "ok" }),
        dispose: () => {},
      }),
    },
    options.audit ?? {
      append: async (event) => {
        events.push(event.type);
      },
    },
    options.now ?? (() => 1000),
  );
  const grant = (maxOperations = 2) =>
    gateway.authorizeTask("task-1", lease, {
      matches: [{ kind: "program-args", program: "df", args: ["-h"] }],
      cwdScopes: ["/srv/app"],
      maxOperations,
      expiresAt: 5000,
      expectedPolicyRevision: policy.revision,
    });
  return { gateway, control, policy, writes, context, grant, events, lease };
}

describe("operation gateway: automatic and cooperative execution", () => {
  it("cooperative mode waits for approval even when a command is allowlisted", async () => {
    const f = fixture({ mode: "collaborative" });
    f.grant();
    const op = await f.gateway.propose(f.context("1"), action());
    await expect(f.gateway.dispatch(op.id)).rejects.toThrow(
      "APPROVAL_REQUIRED",
    );
    expect(f.writes).toEqual([]);
    f.gateway.approveOnce(op.id, op.digest, op.decision.revision);
    expect((await f.gateway.dispatch(op.id)).status).toBe("succeeded");
    expect(f.writes).toEqual(["df -h"]);
  });

  it("automatic mode continuously runs scoped actions and stops at its task limit", async () => {
    const f = fixture();
    f.grant(2);
    for (const requestId of ["1", "2"]) {
      const op = await f.gateway.propose(f.context(requestId), action());
      expect((await f.gateway.dispatch(op.id)).status).toBe("succeeded");
    }
    const extra = await f.gateway.propose(f.context("3"), action());
    await expect(f.gateway.dispatch(extra.id)).rejects.toThrow(
      "APPROVAL_REQUIRED",
    );
    expect(f.writes).toEqual(["df -h", "df -h"]);
    expect(f.events.filter((type) => type === "operation.intent")).toHaveLength(
      2,
    );
  });

  it("does not start the next queued command before the previous result arrives", async () => {
    const firstResult = deferred<{ exitCode: number; output: string }>();
    const firstPrepared = deferred<void>();
    let preparedCount = 0;
    const f = fixture({
      executor: {
        prepare: async () => {
          preparedCount++;
          if (preparedCount === 1) firstPrepared.resolve();
          return {
            bytes: Buffer.from("command"),
            completion:
              preparedCount === 1
                ? firstResult.promise
                : Promise.resolve({ exitCode: 0, output: "second" }),
            dispose: () => {},
          };
        },
      },
    });
    f.grant(2);
    const first = await f.gateway.propose(f.context("1"), action());
    const second = await f.gateway.propose(f.context("2"), action());
    const running = f.gateway.dispatch(first.id);
    const queued = f.gateway.dispatch(second.id);
    await firstPrepared.promise;
    expect(preparedCount).toBe(1);
    firstResult.resolve({ exitCode: 0, output: "first" });
    expect((await running).output).toBe("first");
    expect((await queued).output).toBe("second");
    expect(f.writes).toEqual(["command", "command"]);
  });

  it("rejects deny rules despite a task grant or a requested one-time approval", async () => {
    const f = fixture();
    f.grant();
    f.policy.sets.push({
      id: "host",
      scope: { type: "host", id: "host-1" },
      strictAllowlist: false,
      rules: [
        {
          id: "deny-df",
          effect: "deny",
          match: { kind: "program", program: "df" },
          reason: "禁用",
        },
      ],
    });
    const op = await f.gateway.propose(f.context("1"), action());
    expect(op.decision.outcome).toBe("deny");
    expect(() =>
      f.gateway.approveOnce(op.id, op.digest, op.decision.revision),
    ).toThrow("POLICY_DENIED");
    await expect(f.gateway.dispatch(op.id)).rejects.toThrow("POLICY_DENIED");
    expect(f.writes).toEqual([]);
  });

  it("checks takeover again after slow audit work immediately before writing", async () => {
    const entered = deferred<void>(),
      release = deferred<void>();
    const f = fixture({
      audit: {
        append: async (event) => {
          if (event.type === "operation.intent") {
            entered.resolve();
            await release.promise;
          }
        },
      },
    });
    f.grant();
    const op = await f.gateway.propose(f.context("1"), action());
    const running = f.gateway.dispatch(op.id);
    await entered.promise;
    f.control.takeover();
    f.control.humanInput(Buffer.from("manual"));
    release.resolve();
    expect((await running).status).toBe("cancelled-before-send");
    expect(f.writes).toEqual(["manual"]);
  });

  it("does not reuse approval after a policy revision changes during audit", async () => {
    const entered = deferred<void>(),
      release = deferred<void>();
    const f = fixture({
      mode: "collaborative",
      audit: {
        append: async (event) => {
          if (event.type === "operation.intent") {
            entered.resolve();
            await release.promise;
          }
        },
      },
    });
    const op = await f.gateway.propose(f.context("1"), action());
    f.gateway.approveOnce(op.id, op.digest, op.decision.revision);
    const running = f.gateway.dispatch(op.id);
    await entered.promise;
    f.policy.revision++;
    release.resolve();
    expect((await running).status).toBe("cancelled-before-send");
    expect(f.writes).toEqual([]);
  });

  it("never executes a retried request twice or accepts a changed action under the same ID", async () => {
    const f = fixture();
    f.grant();
    const op = await f.gateway.propose(f.context("1"), action());
    op.action.args[0] = "changed";
    const duplicate = await f.gateway.propose(f.context("1"), action());
    expect(duplicate.action.args).toEqual(["-h"]);
    await expect(
      f.gateway.propose(f.context("1"), action("df", ["-i"])),
    ).rejects.toThrow("REQUEST_CONFLICT");
    const first = f.gateway.dispatch(op.id),
      again = f.gateway.dispatch(op.id);
    expect(first).toBe(again);
    await first;
    await again;
    expect(f.writes).toEqual(["df -h"]);
  });

  it("enforces expiry and normalized working-directory scope", async () => {
    let time = 1000;
    const f = fixture({ now: () => time });
    f.grant();
    const outside = await f.gateway.propose(
      f.context("1"),
      action("df", ["-h"], "/srv/app/../other"),
    );
    await expect(f.gateway.dispatch(outside.id)).rejects.toThrow(
      "APPROVAL_REQUIRED",
    );
    const inside = await f.gateway.propose(f.context("2"), action());
    time = 5000;
    await expect(f.gateway.dispatch(inside.id)).rejects.toThrow(
      "APPROVAL_REQUIRED",
    );
    expect(f.writes).toEqual([]);
  });

  it("treats a missing exit status as unknown and pauses automation", async () => {
    const f = fixture({
      executor: {
        prepare: async () => ({
          bytes: Buffer.from("df -h"),
          completion: Promise.resolve({
            exitCode: null,
            output: "connection lost",
          }),
          dispose: () => {},
        }),
      },
    });
    f.grant();
    const op = await f.gateway.propose(f.context("1"), action());
    expect((await f.gateway.dispatch(op.id)).status).toBe("unknown");
    expect(f.control.snapshot().controller.kind).toBe("human");
  });

  it("an old command result never revokes a newer task's control", async () => {
    const completion = deferred<{ exitCode: number | null; output: string }>();
    const intent = deferred<void>();
    const f = fixture({
      audit: {
        append: async (event) => {
          if (event.type === "operation.intent") intent.resolve();
        },
      },
      executor: {
        prepare: async () => ({
          bytes: Buffer.from("first"),
          completion: completion.promise,
          dispose: () => {},
        }),
      },
    });
    f.grant();
    const op = await f.gateway.propose(f.context("1"), action());
    const running = f.gateway.dispatch(op.id);
    await intent.promise;
    await Promise.resolve();
    expect(f.writes).toEqual(["first"]);
    f.control.takeover();
    const newer = f.control.grant(
      { kind: "automation", ownerId: "new-task", ownerType: "agent-task" },
      f.control.snapshot(),
    );
    completion.resolve({ exitCode: null, output: "lost" });
    await running;
    expect(() => f.control.assertLease(newer)).not.toThrow();
  });

  it("audit failure prevents sending and pauses the current automation", async () => {
    const f = fixture({
      audit: {
        append: async (event) => {
          if (event.type === "operation.intent")
            throw new Error("AUDIT_UNAVAILABLE");
        },
      },
    });
    f.grant();
    const op = await f.gateway.propose(f.context("1"), action());
    const result = await f.gateway.dispatch(op.id);
    expect(f.writes).toEqual([]);
    expect(result.auditGap).toBe(true);
    expect(f.control.snapshot().controller.kind).toBe("human");
  });
});

describe("approval freshness and caller boundaries", () => {
  it("rejects a human approval from an old policy preview", async () => {
    const f = fixture({ mode: "collaborative" });
    const op = await f.gateway.propose(f.context("1"), action());
    f.policy.revision++;
    expect(() =>
      f.gateway.approveOnce(op.id, op.digest, op.decision.revision),
    ).toThrow("POLICY_CHANGED");
    expect(f.writes).toEqual([]);
  });
  it("cannot turn an automation proposal into unrestricted manual input", async () => {
    const f = fixture();
    await expect(
      f.gateway.propose(
        { ...f.context("1"), origin: "manual-terminal" as never },
        action(),
      ),
    ).rejects.toThrow("INVALID_CONTEXT");
    expect(f.writes).toEqual([]);
  });
  it("isolates an executor cleanup failure and pauses further automatic writes", async () => {
    const f = fixture({
      executor: {
        prepare: async () => ({
          bytes: Buffer.from("done"),
          completion: Promise.resolve({ exitCode: 0, output: "done" }),
          dispose: () => {
            throw new Error("cleanup failed");
          },
        }),
      },
    });
    f.grant();
    const op = await f.gateway.propose(f.context("1"), action());
    const result = await f.gateway.dispatch(op.id);
    expect(result.status).toBe("succeeded");
    expect(result.error).toBe("CLEANUP_FAILED");
    expect(f.control.snapshot().controller.kind).toBe("human");
  });
});

describe("scope rule intersection", () => {
  it("intersects allowlists across all applicable groups", () => {
    const policies: CommandPolicySnapshot = {
      revision: 1,
      sets: [
        {
          id: "a",
          scope: { type: "group", id: "a" },
          strictAllowlist: true,
          rules: [
            {
              id: "df",
              effect: "allow",
              match: { kind: "program", program: "df" },
              reason: "",
            },
          ],
        },
        {
          id: "b",
          scope: { type: "group", id: "b" },
          strictAllowlist: true,
          rules: [
            {
              id: "pwd",
              effect: "allow",
              match: { kind: "program", program: "pwd" },
              reason: "",
            },
          ],
        },
      ],
    };
    expect(
      evaluateCommandPolicy(
        policies,
        { hostId: "h", taskId: "t", groupIds: ["a", "b"] },
        action(),
      ).outcome,
    ).toBe("deny");
    expect(
      evaluateCommandPolicy(
        policies,
        { hostId: "h", taskId: "t", groupIds: ["a"] },
        action(),
      ).outcome,
    ).toBe("allow");
  });

  it("requires review for opaque interpreters and rejects them in strict mode", () => {
    const f = fixture();
    f.policy.sets[0].rules = [
      {
        id: "python",
        effect: "allow",
        match: { kind: "program", program: "python3" },
        reason: "",
      },
    ];
    const target = { hostId: "host-1", taskId: "task-1", groupIds: [] };
    expect(
      evaluateCommandPolicy(
        f.policy,
        target,
        action("python3", ["-c", "print(1)"]),
      ).outcome,
    ).toBe("unknown");
    f.policy.sets[0].strictAllowlist = true;
    expect(
      evaluateCommandPolicy(
        f.policy,
        target,
        action("python3", ["-c", "print(1)"]),
      ).outcome,
    ).toBe("deny");
  });
});

describe("workflow timeout and takeover", () => {
  it("records timeout as unknown and requests interruption only under its current lease", async () => {
    const f = fixture({
      executor: {
        prepare: async () => ({
          bytes: Buffer.from("df -h"),
          completion: Promise.resolve({
            exitCode: null,
            output: "partial",
            timedOut: true,
          }),
          dispose: () => {},
        }),
      },
    });
    f.grant();
    const proposal = await f.gateway.propose(f.context("timeout"), {
      ...action(),
      timeoutMs: 1000,
    });
    const result = await f.gateway.dispatch(proposal.id);
    expect(result).toMatchObject({
      status: "unknown",
      exitCode: null,
      timedOut: true,
      interruptionRequested: true,
    });
    expect(result.startedAt).toBeDefined();
    expect(result.endedAt).toBeDefined();
    expect(f.writes).toEqual(["df -h", "\x03"]);
  });
  it("does not send a late timeout interrupt after human takeover", async () => {
    const complete = deferred<{
      exitCode: null;
      output: string;
      timedOut: true;
    }>();
    const f = fixture({
      executor: {
        prepare: async () => ({
          bytes: Buffer.from("df -h"),
          completion: complete.promise,
          dispose: () => {},
        }),
      },
    });
    f.grant();
    const proposal = await f.gateway.propose(f.context("timeout"), action());
    const pending = f.gateway.dispatch(proposal.id);
    await vi.waitFor(() => expect(f.writes).toHaveLength(1));
    f.control.takeover();
    complete.resolve({ exitCode: null, output: "late", timedOut: true });
    await pending;
    expect(f.writes).toEqual(["df -h"]);
  });
});

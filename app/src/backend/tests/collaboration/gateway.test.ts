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

it("preserves unknown status and revokes control for malformed command frames", async () => {
  const f = fixture({
    executor: {
      prepare: async () => ({
        bytes: Buffer.from("command"),
        completion: Promise.resolve({
          exitCode: 0,
          cwd: "/untrusted-result",
          output: "unverified",
          protocolError: true,
        }),
        dispose: () => {},
      }),
    },
  });
  f.grant();
  const op = await f.gateway.propose(f.context("bad-frame"), action());
  const result = await f.gateway.dispatch(op.id);
  expect(result).toMatchObject({
    status: "unknown",
    exitCode: null,
    error: "SHELL_PROTOCOL_INVALID",
  });
  expect(result.resultingCwd).toBeUndefined();
  expect(f.control.snapshot().controller.kind).toBe("human");
  expect(f.writes).toEqual(["command"]);
});

it("allows directory records past the ordinary command cap while keeping that cap intact", async () => {
  const f = fixture();
  f.grant(5000);
  const directory = {
    type: "file.directory.preview" as const,
    direction: "upload" as const,
    path: "/srv/app",
    localGrantId: "00000000-0000-4000-8000-000000000001",
    localVersion: "00000000-0000-4000-8000-000000000002",
    overwrite: false,
  };
  try {
    for (let i = 0; i < 513; i++)
      await f.gateway.propose(f.context("directory-" + i), directory);
    for (let i = 0; i < 512; i++)
      await f.gateway.propose(f.context("command-" + i), action());
    await expect(
      f.gateway.propose(f.context("command-over-limit"), action()),
    ).rejects.toThrow("SESSION_OPERATION_LIMIT");
    const extra = await f.gateway.propose(
      f.context("directory-extra"),
      directory,
    );
    expect(
      (await f.gateway.propose(f.context("directory-extra"), directory)).id,
    ).toBe(extra.id);
    expect(f.writes).toEqual([]);
  } finally {
    f.control.close();
  }
});
it("bounds both individual and cumulative directory manifests without consuming command slots", async () => {
  const f = fixture();
  const directory = {
    type: "file.directory.preview" as const,
    direction: "upload" as const,
    path: "/srv/app",
    localGrantId: "00000000-0000-4000-8000-000000000001",
    localVersion: "00000000-0000-4000-8000-000000000002",
    overwrite: false,
  };
  try {
    await expect(
      f.gateway.propose(f.context("too-large"), {
        ...directory,
        renames: Array.from({ length: 4096 }, (_, i) => ({
          relativePath: "file-" + i,
          name: "a".repeat(255),
        })),
      }),
    ).rejects.toThrow("SESSION_OPERATION_LIMIT");
    const manifest = {
      ...directory,
      renames: Array.from({ length: 1024 }, (_, i) => ({
        relativePath: "file-" + i,
        name: "a".repeat(200),
      })),
    };
    let rejected = false;
    for (let i = 0; i < 100; i++) {
      try {
        await f.gateway.propose(f.context("manifest-" + i), manifest);
      } catch (e) {
        expect((e as Error).message).toBe("SESSION_OPERATION_LIMIT");
        rejected = true;
        break;
      }
    }
    expect(rejected).toBe(true);
    expect(
      (await f.gateway.propose(f.context("ordinary-after-manifests"), action()))
        .status,
    ).toBe("proposed");
    expect(f.writes).toEqual([]);
  } finally {
    f.control.close();
  }
});

it.each(["agent", "workflow", "mcp", "command-panel"] as const)(
  "enforces every deny scope for %s in both controlled modes",
  async (origin) => {
    for (const mode of ["automatic", "collaborative"] as const) {
      for (const scope of [
        { type: "global" },
        { type: "group", id: "production" },
        { type: "host", id: "host-1" },
        { type: "task", id: "task-1" },
      ] as const) {
        const f = fixture({ mode });
        f.grant();
        f.policy.sets.push({
          id: "blocking-" + scope.type,
          scope,
          strictAllowlist: false,
          rules: [
            {
              id: "deny",
              effect: "deny",
              match: { kind: "program", program: "df" },
              reason: "不可绕过",
            },
          ],
        });
        const context = { ...f.context("scope-" + scope.type), origin };
        const operation = await f.gateway.propose(context, action());
        expect(operation.decision.outcome).toBe("deny");
        expect(operation.decision.matchedRules).toContain(
          "blocking-" + scope.type + "/deny",
        );
        expect(() =>
          f.gateway.approveOnce(
            operation.id,
            operation.digest,
            operation.decision.revision,
          ),
        ).toThrow("POLICY_DENIED");
        await expect(f.gateway.dispatch(operation.id)).rejects.toThrow(
          "POLICY_DENIED",
        );
        expect(f.writes).toEqual([]);
      }
    }
  },
);

it.each(["agent", "workflow", "mcp", "command-panel"] as const)(
  "honors allow/confirm grants and ignores unrelated scopes for %s",
  async (origin) => {
    for (const mode of ["automatic", "collaborative"] as const) {
      for (const effect of ["allow", "confirm"] as const) {
        const f = fixture({ mode });
        f.policy.sets[0].rules[0].effect = effect;
        for (const scope of [
          { type: "group", id: "other-group" },
          { type: "host", id: "other-host" },
          { type: "task", id: "other-task" },
        ] as const) {
          f.policy.sets.push({
            id: "unrelated-" + scope.type,
            scope,
            strictAllowlist: true,
            rules: [
              {
                id: "deny",
                effect: "deny",
                match: { kind: "program", program: "df" },
                reason: "不属于当前目标",
              },
            ],
          });
        }
        const context = (id: string) => ({ ...f.context(id), origin });
        const unapproved = await f.gateway.propose(
          context("before-grant"),
          action(),
        );
        expect(unapproved.decision.outcome).toBe(effect);
        expect(
          unapproved.decision.matchedRules.some((id) =>
            id.startsWith("unrelated-"),
          ),
        ).toBe(false);
        await expect(f.gateway.dispatch(unapproved.id)).rejects.toThrow(
          "APPROVAL_REQUIRED",
        );
        expect(f.writes).toEqual([]);
        f.grant(2);
        const allowed = await f.gateway.propose(context("in-grant"), action());
        if (mode === "collaborative") {
          await expect(f.gateway.dispatch(allowed.id)).rejects.toThrow(
            "APPROVAL_REQUIRED",
          );
          expect(f.writes).toEqual([]);
          f.gateway.approveOnce(
            allowed.id,
            allowed.digest,
            allowed.decision.revision,
          );
        }
        expect((await f.gateway.dispatch(allowed.id)).status).toBe("succeeded");
        expect(f.writes).toEqual(["df -h"]);
        const outside = await f.gateway.propose(
          context("outside-grant"),
          action("df", ["-i"]),
        );
        await expect(f.gateway.dispatch(outside.id)).rejects.toThrow(
          "APPROVAL_REQUIRED",
        );
        const next = await f.gateway.propose(
          context("second-in-grant"),
          action(),
        );
        if (mode === "collaborative")
          await expect(f.gateway.dispatch(next.id)).rejects.toThrow(
            "APPROVAL_REQUIRED",
          );
        else
          expect((await f.gateway.dispatch(next.id)).status).toBe("succeeded");
        expect(f.writes).toHaveLength(mode === "collaborative" ? 1 : 2);
      }
    }
  },
);

it("keeps a global deny above a host allow regardless of rule order", async () => {
  for (const reversed of [false, true]) {
    const f = fixture();
    f.grant();
    f.policy.sets[0].rules[0].effect = "deny";
    f.policy.sets.push({
      id: "host-allow",
      scope: { type: "host", id: "host-1" },
      strictAllowlist: false,
      rules: [
        {
          id: "allow",
          effect: "allow",
          match: { kind: "program", program: "df" },
          reason: "主机允许",
        },
      ],
    });
    if (reversed) f.policy.sets.reverse();
    const op = await f.gateway.propose(
      f.context("global-host-conflict"),
      action(),
    );
    expect(op.decision.outcome).toBe("deny");
    expect(op.decision.matchedRules).toEqual(
      expect.arrayContaining(["global/allow-df", "host-allow/allow"]),
    );
    await expect(f.gateway.dispatch(op.id)).rejects.toThrow("POLICY_DENIED");
    expect(f.writes).toEqual([]);
  }
});

it.each(
  [
    "sh",
    "bash",
    "zsh",
    "fish",
    "dash",
    "eval",
    "python",
    "python3",
    "node",
    "perl",
    "ruby",
    "powershell",
    "pwsh",
    "cmd",
    "sudo",
    "su",
    "env",
    "xargs",
    "vi",
    "vim",
    "nvim",
    "nano",
    "emacs",
    "less",
    "more",
    "top",
    "htop",
    "btop",
    "tmux",
    "screen",
  ].flatMap((program) =>
    (["automatic", "collaborative"] as const).map((mode) => ({
      program,
      mode,
    })),
  ),
)(
  "does not treat $program as ordinarily allowlisted in $mode mode",
  async ({ program, mode }) => {
    for (const qualified of [program, "/usr/bin/" + program]) {
      const f = fixture({ mode });
      f.policy.sets[0].rules = [
        {
          id: "allow-interactive",
          effect: "allow",
          match: { kind: "program", program: qualified },
          reason: "显式程序允许仍不证明交互安全",
        },
      ];
      f.gateway.authorizeTask("task-1", f.lease, {
        matches: [{ kind: "program", program: qualified }],
        cwdScopes: ["/srv/app"],
        maxOperations: 2,
        expiresAt: 5000,
        expectedPolicyRevision: 1,
      });
      const proposed = await f.gateway.propose(
        f.context("interactive"),
        action(qualified, []),
      );
      expect(proposed.decision.outcome).toBe("unknown");
      await expect(f.gateway.dispatch(proposed.id)).rejects.toThrow(
        "APPROVAL_REQUIRED",
      );
      expect(f.writes).toEqual([]);
      f.policy.sets[0].strictAllowlist = true;
      const strict = await f.gateway.propose(
        f.context("strict-interactive"),
        action(qualified, []),
      );
      expect(strict.decision.outcome).toBe("deny");
      expect(strict.decision.reasons).toContain(
        "OPAQUE_COMMAND_IN_STRICT_MODE",
      );
      expect(() => f.gateway.approveOnce(strict.id, strict.digest, 1)).toThrow(
        "POLICY_DENIED",
      );
      await expect(f.gateway.dispatch(strict.id)).rejects.toThrow(
        "POLICY_DENIED",
      );
      expect(f.writes).toEqual([]);
    }
  },
);

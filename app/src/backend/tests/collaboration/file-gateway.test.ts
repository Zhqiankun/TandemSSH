import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  OperationGateway,
  type FileExecutorPort,
  type OperationContext,
  type OperationAuditPort,
} from "../../collaboration/operations/gateway";
import { SessionControl } from "../../collaboration/sessions/control";
import {
  evaluateFilePolicy,
  validateFileAction,
  fileScopeAllows,
} from "../../collaboration/policies/file-policy";
import { validatePolicySets } from "../../collaboration/policies/schema";
import type { CommandPolicySnapshot } from "../../../types/collaboration-operations";
import type { FileAction, FileScope } from "../../../types/file-operations";
const read: FileAction = { type: "file.read", path: "/srv/config" };
const write: FileAction = {
  type: "file.write",
  path: "/srv/config",
  canonicalPath: "/srv/config",
  proposalId: randomUUID(),
  version: randomUUID(),
  contentHash: "a".repeat(64),
  bytes: 100,
  format: { charset: "utf8", bom: false, lineEnding: "lf" },
};
const scopes: FileScope[] = [
  { kind: "directory", path: "/srv", access: ["read", "write"] },
];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
function fixture(
  mode: OperationContext["mode"] = "automatic",
  custom?: FileExecutorPort,
  beforeAudit?: OperationAuditPort["append"],
) {
  const writes: string[] = [],
    events: unknown[] = [],
    io: string[] = [];
  const control = new SessionControl(
    "session",
    {
      isReady: () => true,
      write: (bytes) => writes.push(Buffer.from(bytes).toString()),
    },
    () => {},
  );
  const lease = control.grant(
    { kind: "automation", ownerType: "agent-task", ownerId: "task" },
    control.snapshot(),
  );
  const policy: CommandPolicySnapshot = { revision: 1, sets: [] };
  const dispose = vi.fn();
  const files = custom ?? {
    prepare: async (action) => ({
      execute: async (guard) => {
        guard(action.canonicalPath ?? action.path);
        io.push(action.type);
        return { status: "succeeded" as const, result: { bytes: 100 } };
      },
      dispose,
    }),
  };
  const gateway = new OperationGateway(
    control,
    { hostId: "1", groupIds: ["prod"] },
    () => policy,
    {
      prepare: async () => ({
        bytes: Buffer.from("pwd"),
        completion: Promise.resolve({ exitCode: 0, output: "/srv" }),
        dispose: () => {},
      }),
    },
    {
      append: async (event) => {
        events.push(event);
        await beforeAudit?.(event);
      },
    },
    Date.now,
    undefined,
    files,
  );
  const context = (requestId: string): OperationContext => ({
    taskId: "task",
    requestId,
    mode,
    origin: "mcp",
    lease,
  });
  const grant = (fileScopes = scopes, maxOperations = 5) =>
    gateway.authorizeTask("task", lease, {
      matches: [{ kind: "program", program: "pwd" }],
      fileScopes,
      cwdScopes: ["/srv"],
      maxOperations,
      expiresAt: Date.now() + 60000,
      expectedPolicyRevision: policy.revision,
    });
  return {
    gateway,
    control,
    policy,
    writes,
    events,
    io,
    dispose,
    context,
    grant,
  };
}
afterEach(() => vi.useRealTimers());
describe("independent file path rules", () => {
  it("normalizes traversal and enforces a directory boundary on both requested and resolved paths", () => {
    expect(
      fileScopeAllows(scopes, {
        type: "file.read",
        path: "/srv/../etc/passwd",
      }),
    ).toBe(false);
    expect(
      fileScopeAllows(scopes, { type: "file.read", path: "/srv-extra/file" }),
    ).toBe(false);
    expect(
      fileScopeAllows(scopes, {
        type: "file.read",
        path: "/srv/link",
        canonicalPath: "/etc/secret",
      }),
    ).toBe(false);
    expect(
      fileScopeAllows(scopes, { type: "file.read", path: "/srv/中文%2F.txt" }),
    ).toBe(true);
  });
  it("a deny on the resolved target wins even when the requested link is allowed", () => {
    const policy: CommandPolicySnapshot = {
      revision: 2,
      sets: [
        {
          id: "global",
          scope: { type: "global" },
          strictAllowlist: false,
          rules: [],
          fileRules: [
            {
              id: "deny",
              effect: "deny",
              match: { kind: "directory", path: "/etc", access: ["read"] },
              reason: "secret",
            },
            { id: "allow", effect: "allow", match: scopes[0], reason: "app" },
          ],
        },
      ],
    };
    const decision = evaluateFilePolicy(
      policy,
      { hostId: "1", groupIds: [], taskId: "t" },
      { type: "file.read", path: "/srv/link", canonicalPath: "/etc/secret" },
    );
    expect(decision.outcome).toBe("deny");
    expect(decision.matchedRules).toContain("global/deny");
  });
  it("a command allowlist never grants file access, and each file allowlist must cover both paths", () => {
    const policy: CommandPolicySnapshot = {
      revision: 1,
      sets: [
        {
          id: "one",
          scope: { type: "global" },
          strictAllowlist: true,
          rules: [],
        },
      ],
    };
    expect(
      evaluateFilePolicy(
        policy,
        { hostId: "1", groupIds: [], taskId: "t" },
        read,
      ).outcome,
    ).toBe("confirm");
    policy.sets[0].strictFileAllowlist = true;
    expect(
      evaluateFilePolicy(
        policy,
        { hostId: "1", groupIds: [], taskId: "t" },
        read,
      ).outcome,
    ).toBe("deny");
  });
  it("persists file rules through strict schema and rejects duplicate IDs or injected bodies", () => {
    const set = {
      id: "one",
      scope: { type: "global" as const },
      strictAllowlist: false,
      rules: [],
      fileRules: [
        {
          id: "files",
          effect: "deny" as const,
          match: scopes[0],
          reason: "test",
        },
      ],
    };
    expect(validatePolicySets([set])[0].fileRules).toEqual(set.fileRules);
    expect(() =>
      validatePolicySets([
        {
          ...set,
          rules: [
            {
              id: "files",
              effect: "deny",
              match: { kind: "program", program: "cat" },
              reason: "test",
            },
          ],
        },
      ]),
    ).toThrow("DUPLICATE_RULE_ID");
    expect(() =>
      validateFileAction({ ...write, content: "secret" } as FileAction),
    ).toThrow("INVALID_FILE_ACTION");
  });
});
describe("file actions in the shared gateway", () => {
  it("requires an explicit file scope even after one-action approval", async () => {
    const f = fixture();
    f.grant([]);
    const op = await f.gateway.propose(f.context("r"), read);
    f.gateway.approveOnce(op.id, op.digest, 1);
    await expect(f.gateway.dispatch(op.id)).rejects.toThrow(
      "FILE_SCOPE_EXCEEDED",
    );
    expect(f.io).toEqual([]);
    expect(f.writes).toEqual([]);
  });
  it("runs automatic file operations without injecting terminal bytes and charges each operation once", async () => {
    const f = fixture();
    f.grant(scopes, 1);
    const op = await f.gateway.propose(f.context("r"), write);
    const [a, b] = await Promise.all([
      f.gateway.dispatch(op.id),
      f.gateway.dispatch(op.id),
    ]);
    expect(a.status).toBe("succeeded");
    expect(a).toEqual(b);
    expect(a.exitCode).toBeUndefined();
    expect(f.io).toEqual(["file.write"]);
    expect(f.writes).toEqual([]);
    const second = await f.gateway.propose(f.context("r2"), read);
    await expect(f.gateway.dispatch(second.id)).rejects.toThrow(
      "FILE_SCOPE_REQUIRED",
    );
  });
  it("cooperative file operations wait for approval and deny rules cannot be approved away", async () => {
    const f = fixture("collaborative");
    f.grant();
    const op = await f.gateway.propose(f.context("r"), read);
    await expect(f.gateway.dispatch(op.id)).rejects.toThrow(
      "APPROVAL_REQUIRED",
    );
    expect(f.io).toEqual([]);
    f.gateway.approveOnce(op.id, op.digest, 1);
    expect((await f.gateway.dispatch(op.id)).status).toBe("succeeded");
    f.policy.sets = [
      {
        id: "g",
        scope: { type: "global" },
        strictAllowlist: false,
        rules: [],
        fileRules: [
          { id: "deny", effect: "deny", match: scopes[0], reason: "test" },
        ],
      },
    ];
    const denied = await f.gateway.propose(f.context("r2"), write);
    expect(() => f.gateway.approveOnce(denied.id, denied.digest, 1)).toThrow(
      "POLICY_DENIED",
    );
  });
  it("serializes terminal commands behind an ongoing file operation", async () => {
    const gate = deferred(),
      entered = deferred();
    const f = fixture("automatic", {
      prepare: async (action) => ({
        execute: async (guard) => {
          guard(action.path);
          entered.resolve();
          await gate.promise;
          guard();
          return { status: "succeeded" };
        },
        dispose: () => {},
      }),
    });
    f.grant();
    const file = await f.gateway.propose(f.context("file"), read),
      pending = f.gateway.dispatch(file.id);
    await entered.promise;
    const command = await f.gateway.propose(f.context("command"), {
        type: "terminal.command",
        program: "pwd",
        args: [],
        cwd: "/srv",
      }),
      tail = f.gateway.dispatch(command.id);
    expect(f.writes).toEqual([]);
    gate.resolve();
    await pending;
    await tail;
    expect(f.writes).toEqual(["pwd"]);
  });
  it("takeover prevents the next chunk and a late success cannot overwrite unknown", async () => {
    const gate = deferred(),
      entered = deferred(),
      chunks: string[] = [];
    const f = fixture("automatic", {
      prepare: async (action) => ({
        execute: async (guard) => {
          guard(action.path);
          chunks.push("first");
          entered.resolve();
          await gate.promise;
          guard();
          chunks.push("second");
          return { status: "succeeded" };
        },
        dispose: () => {},
      }),
    });
    f.grant();
    const op = await f.gateway.propose(f.context("r"), write),
      pending = f.gateway.dispatch(op.id);
    await entered.promise;
    f.control.takeover();
    gate.resolve();
    const result = await pending;
    expect(result.status).toBe("unknown");
    expect(chunks).toEqual(["first"]);
    expect(f.writes).toEqual([]);
  });
  it("rechecks canonical paths before later I/O", async () => {
    let reads = 0;
    const f = fixture("automatic", {
      prepare: async () => ({
        execute: async (guard) => {
          guard("/etc/secret");
          reads++;
          return { status: "succeeded" };
        },
        dispose: () => {},
      }),
    });
    f.grant();
    const op = await f.gateway.propose(f.context("r"), read),
      result = await f.gateway.dispatch(op.id);
    expect(result.error).toBe("FILE_SCOPE_EXCEEDED");
    expect(reads).toBe(0);
  });
  it("rejects file bodies in execution results before journaling them", async () => {
    const f = fixture("automatic", {
      prepare: async (action) => ({
        execute: async (guard) => {
          guard(action.path);
          return {
            status: "succeeded",
            result: { bytes: 1, content: "NEVER_LOG_FILE_BODY" },
          };
        },
        dispose: () => {},
      }),
    });
    f.grant();
    const op = await f.gateway.propose(f.context("r"), read);
    expect((await f.gateway.dispatch(op.id)).error).toBe("INVALID_FILE_RESULT");
    expect(JSON.stringify(f.events)).not.toContain("NEVER_LOG_FILE_BODY");
  });
  it("a file timeout revokes its lease without sending a terminal interrupt", async () => {
    vi.useFakeTimers();
    let lateGuard: (path?: string) => void = () => {};
    const f = fixture("automatic", {
      prepare: async () => ({
        execute: (guard) => {
          lateGuard = guard;
          guard("/srv/config");
          return new Promise(() => {});
        },
        dispose: () => {},
      }),
    });
    f.grant();
    const op = await f.gateway.propose(f.context("r"), {
      ...read,
      timeoutMs: 1000,
    });
    const pending = f.gateway.dispatch(op.id);
    await vi.advanceTimersByTimeAsync(1001);
    const result = await pending;
    expect(result.status).toBe("unknown");
    expect(result.timedOut).toBe(true);
    expect(result.error).toBe("FILE_OPERATION_TIMEOUT");
    expect(f.control.snapshot().controller.kind).toBe("human");
    expect(f.writes).toEqual([]);
    expect(() => lateGuard()).toThrow("STALE_CONTROL");
  });
});

it("sanitizes unexpected file adapter exceptions before publishing or auditing", async () => {
  const f = fixture("automatic", {
    prepare: async (action) => ({
      execute: async (guard) => {
        guard(action.path);
        throw Error("api_key=private-file-value");
      },
      dispose: () => {},
    }),
  });
  f.grant();
  const op = await f.gateway.propose(f.context("error"), read);
  const result = await f.gateway.dispatch(op.id);
  expect(result.error).toBe("FILE_OPERATION_FAILED");
  expect(JSON.stringify(f.events)).not.toContain("private-file-value");
});

it.each([
  { error: "FILE_IO_FAILED" },
  { result: { commitMayHaveOccurred: true } },
])(
  "rejects success that also reports failure or uncertainty: %j",
  async (details) => {
    const f = fixture("automatic", {
      prepare: async (action) => ({
        execute: async (guard) => {
          guard(action.path);
          return { status: "succeeded", ...details };
        },
        dispose: () => {},
      }),
    });
    f.grant();
    const op = await f.gateway.propose(f.context("contradiction"), read);
    expect((await f.gateway.dispatch(op.id)).error).toBe("INVALID_FILE_RESULT");
  },
);

it("invalidates a file approval when policy changes during intent journaling", async () => {
  const entered = deferred(),
    release = deferred();
  const f = fixture("collaborative", undefined, async (event) => {
    if (event.type === "operation.intent") {
      entered.resolve();
      await release.promise;
    }
  });
  f.grant();
  const operation = await f.gateway.propose(
    f.context("file-policy-race"),
    write,
  );
  f.gateway.approveOnce(
    operation.id,
    operation.digest,
    operation.decision.revision,
  );
  const pending = f.gateway.dispatch(operation.id);
  await entered.promise;
  f.policy.revision++;
  release.resolve();
  expect((await pending).status).toBe("cancelled-before-send");
  expect(f.io).toEqual([]);
  expect(f.writes).toEqual([]);
});
it("stops later file chunks after a policy revision change", async () => {
  const entered = deferred(),
    release = deferred(),
    chunks: string[] = [];
  const f = fixture("automatic", {
    prepare: async (action) => ({
      execute: async (guard) => {
        guard(action.path);
        chunks.push("first");
        entered.resolve();
        await release.promise;
        guard(action.path);
        chunks.push("second");
        return { status: "succeeded" };
      },
      dispose: () => {},
    }),
  });
  f.grant();
  const operation = await f.gateway.propose(
      f.context("file-policy-chunk"),
      write,
    ),
    pending = f.gateway.dispatch(operation.id);
  await entered.promise;
  f.policy.revision++;
  release.resolve();
  expect((await pending).status).toBe("unknown");
  expect(chunks).toEqual(["first"]);
  expect(f.writes).toEqual([]);
});

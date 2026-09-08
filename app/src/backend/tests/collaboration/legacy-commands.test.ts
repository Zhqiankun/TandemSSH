import { afterEach, describe, expect, it, vi } from "vitest";
import { compileLegacy } from "../../collaboration/legacy/compile";
import { LegacyCommandService } from "../../collaboration/legacy/service";
import { TaskRuntime } from "../../collaboration/tasks/runtime";
import { SessionControl } from "../../collaboration/sessions/control";
import type { CommandPolicySnapshot } from "../../../types/collaboration-operations";
const host = { ip: "127.0.0.1", username: "fixture", port: 22, name: "服务器" };
const closed: Array<() => void> = [];
afterEach(() => closed.splice(0).forEach((fn) => fn()));
function fixture() {
  const writes: string[] = [],
    control = new SessionControl(
      "session",
      {
        isReady: () => true,
        write: (data) => writes.push(Buffer.from(data).toString()),
      },
      () => {},
    ),
    policy: CommandPolicySnapshot = {
      revision: 1,
      sets: [
        {
          id: "global",
          scope: { type: "global" },
          strictAllowlist: false,
          rules: [
            {
              id: "no-rm",
              effect: "deny",
              match: { kind: "program", program: "rm" },
              reason: "禁止删除",
            },
          ],
        },
      ],
    };
  const session = {
    id: "session",
    userId: "owner",
    hostId: 7,
    hostName: "fixture@127.0.0.1:22",
    groups: () => [],
    control,
    executor: {
      prepareContext: () => ({
        bytes: Buffer.from("context"),
        completion: Promise.resolve({ exitCode: 0, output: "", cwd: "/srv" }),
        dispose: () => {},
      }),
      prepare: async (action: { program: string }) => ({
        bytes: Buffer.from(action.program),
        completion: Promise.resolve({
          exitCode: 0,
          output: "done",
          cwd: "/srv",
        }),
        dispose: () => {},
      }),
    },
  };
  const tasks = new TaskRuntime({
      getSession: (id) => (id === session.id ? session : null),
      policy: async () => policy,
      audit: () => ({ record: async () => {}, append: async () => {} }),
    }),
    notify = vi.fn(),
    target = vi.fn(async (userId: string) => {
      if (userId !== "owner") throw Error("SESSION_NOT_FOUND");
      return {
        hostId: 7,
        hostName: session.hostName,
        host,
        control: control.snapshot(),
      };
    }),
    service = new LegacyCommandService({ tasks, notify, target });
  closed.push(() => control.close());
  return { writes, control, policy, tasks, service, target, notify };
}
describe("legacy plan compilation", () => {
  it("binds input values after tokenization, without interpreting shell syntax", () => {
    const input = "space ; rm -rf /\n$&$$$'";
    const result = compileLegacy(
      {
        kind: "snippet",
        title: "参数",
        content: 'printf "%s" "$INPUT_1" --host=$HOST',
        inputs: { INPUT_1: input },
      },
      host,
    );
    expect(result.commands).toEqual([
      { program: "printf", args: ["%s", input, "--host=127.0.0.1"] },
    ]);
  });
  it("does not confuse HOSTNAME with the HOST placeholder or allow a dynamic executable", () => {
    expect(() =>
      compileLegacy(
        { kind: "snippet", title: "环境", content: "echo $HOSTNAME" },
        host,
      ),
    ).toThrow("LEGACY_SHELL_MIGRATION_REQUIRED");
    expect(() =>
      compileLegacy(
        {
          kind: "snippet",
          title: "动态",
          content: "$INPUT_1 x",
          inputs: { INPUT_1: "rm" },
        },
        host,
      ),
    ).toThrow("LEGACY_DYNAMIC_PROGRAM");
  });
  it("preserves sequential macro order and expands bounded repetitions", () => {
    const result = compileLegacy(
      {
        kind: "macro",
        title: "重复",
        steps: [
          { id: "1", type: "send", text: "pw", pressEnter: false },
          { id: "2", type: "send", text: "d", pressEnter: true },
          { id: "3", type: "delay", milliseconds: 500 },
          {
            id: "4",
            type: "repeat",
            count: 2,
            steps: [{ id: "5", type: "send", text: "df -h", pressEnter: true }],
          },
        ],
      },
      host,
    );
    expect(result.commands.map((c) => [c.program, c.args])).toEqual([
      ["pwd", []],
      ["sleep", ["0.5"]],
      ["df", ["-h"]],
      ["df", ["-h"]],
    ]);
    expect(result.commands[1].timeoutMs).toBe(5500);
  });
  it("rejects a whole interactive macro or oversized expansion without returning a partial plan", () => {
    expect(() =>
      compileLegacy(
        {
          kind: "macro",
          title: "交互",
          steps: [
            { id: "1", type: "send", text: "pwd", pressEnter: true },
            {
              id: "2",
              type: "wait",
              pattern: "ready",
              timeoutMs: 1000,
              onTimeout: "stop",
            },
          ],
        },
        host,
      ),
    ).toThrow("LEGACY_INTERACTIVE_MIGRATION_REQUIRED");
    expect(() =>
      compileLegacy(
        {
          kind: "snippet",
          title: "大参数",
          content: 'printf "$INPUT_1$INPUT_1"',
          inputs: { INPUT_1: "x".repeat(32768) },
        },
        host,
      ),
    ).toThrow("LEGACY_PLAN_TOO_LARGE");
  });
});
describe("legacy entry becomes an owned shared task", () => {
  it.each(["automatic", "collaborative"] as const)(
    "%s mode waits for authorization and obeys each step",
    async (mode) => {
      const f = fixture(),
        result = await f.service.create("owner", {
          sessionId: "session",
          requestId: "request",
          mode,
          source: { kind: "snippet", title: "巡检", content: "pwd\ndf -h" },
        });
      expect(f.writes).toEqual([]);
      expect(result.task.state).toBe("awaiting-authorization");
      expect(f.notify).toHaveBeenCalledWith("session", result.task.id);
      await f.tasks.authorize(
        { kind: "human", userId: "owner" },
        result.task.id,
        {
          ...f.control.snapshot(),
          policyRevision: 1,
          shellReady: true,
          maxOperations: 5,
          durationMinutes: 5,
          allowReviewedPlan: false,
        },
      );
      if (mode === "collaborative") {
        for (let i = 0; i < 2; i++) {
          await vi.waitFor(() =>
            expect(
              f.tasks.get({ kind: "human", userId: "owner" }, result.task.id)
                .state,
            ).toBe("awaiting-approval"),
          );
          const op = f.tasks
            .get({ kind: "human", userId: "owner" }, result.task.id)
            .operations.at(-1)!;
          await f.tasks.approve(
            { kind: "human", userId: "owner" },
            result.task.id,
            op.id,
            op.digest,
            1,
          );
        }
      }
      await vi.waitFor(() =>
        expect(
          f.tasks.get({ kind: "human", userId: "owner" }, result.task.id).state,
        ).toBe("completed"),
      );
      expect(f.writes).toEqual(["context", "pwd", "df"]);
    },
  );
  it("a deny prevents the old snippet command from reaching the existing terminal", async () => {
    const f = fixture(),
      { task } = await f.service.create("owner", {
        sessionId: "session",
        requestId: "deny",
        mode: "automatic",
        source: { kind: "snippet", title: "删除", content: "rm /srv/config" },
      });
    await f.tasks.authorize({ kind: "human", userId: "owner" }, task.id, {
      ...f.control.snapshot(),
      policyRevision: 1,
      shellReady: true,
      maxOperations: 5,
      durationMinutes: 5,
      allowReviewedPlan: false,
    });
    await vi.waitFor(() =>
      expect(
        f.tasks.get({ kind: "human", userId: "owner" }, task.id).state,
      ).toBe("paused-error"),
    );
    expect(f.writes).toEqual(["context"]);
  });
  it("checks ownership and connection changes before creating a task", async () => {
    const f = fixture(),
      input = {
        sessionId: "session",
        requestId: "r",
        source: { kind: "snippet" as const, title: "读取", content: "pwd" },
      };
    await expect(f.service.create("other", input)).rejects.toThrow(
      "SESSION_NOT_FOUND",
    );
    let count = 0;
    f.target.mockImplementation(async () => {
      if (++count === 2) f.control.connectionChanged();
      return {
        hostId: 7,
        hostName: "fixture@127.0.0.1:22",
        host,
        control: f.control.snapshot(),
      };
    });
    await expect(f.service.create("owner", input)).rejects.toThrow(
      "STALE_SESSION",
    );
    expect(f.tasks.list({ kind: "human", userId: "owner" })).toHaveLength(0);
  });
});

it("keeps all argument bindings distinct when a snippet has more than ten placeholders", () => {
  const inputs = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      "INPUT_" + i,
      "value " + i + " $&$$; literal",
    ]),
  );
  const result = compileLegacy(
    {
      kind: "snippet",
      title: "多参数",
      content:
        "printf " +
        Object.keys(inputs)
          .map((name) => '"$' + name + '"')
          .join(" "),
      inputs,
    },
    host,
  );
  expect(result.commands).toEqual([
    { program: "printf", args: Object.values(inputs) },
  ]);
});

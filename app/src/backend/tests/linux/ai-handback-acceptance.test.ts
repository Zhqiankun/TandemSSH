import { afterEach, expect, it, vi } from "vitest";
import { linuxFixture } from "../../test-helpers/linux-ssh-fixture.js";
import { TaskRuntime } from "../../collaboration/tasks/runtime.js";
import { AiTaskCoordinator } from "../../ai/tasks/runner.js";
import type { ChatChunk, ChatRequest } from "../../ai/providers/types.js";
const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
it
  .runIf(!!process.env.TANDEM_LINUX_MANIFEST)
  .each(["automatic", "collaborative"] as const)(
  "real SSH %s handback includes manual output in the next model request",
  async (mode) => {
    const f = await linuxFixture();
    cleanup.push(f.close);
    const t = await f.terminal();
    cleanup.push(() => t.control.close());
    let output = "",
      cursor = 0;
    t.stream.on("data", (bytes: Buffer) => {
      output = (output + bytes.toString("utf8")).slice(-524288);
      cursor++;
    });
    const runtime = new TaskRuntime({
      getSession: (id) =>
        id === t.id
          ? {
              id: t.id,
              userId: "owner",
              hostId: 1,
              hostName: "linux-fixture",
              groups: () => [],
              control: t.control,
              executor: t.executor,
              readOutput: () => ({
                text: output,
                cursor,
                generation: t.control.snapshot().generation,
                truncated: false,
              }),
            }
          : null,
      policy: async () => ({ revision: 1, sets: [] }),
      audit: () => ({ append: async () => {}, record: async () => {} }),
    });
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const requests: ChatRequest[] = [];
    const coordinator = new AiTaskCoordinator({
      tasks: runtime,
      validate: async () => ({ label: "隔离模型夹具" }),
      audit: async () => {},
      stream: async function* (
        _user,
        _provider,
        request,
      ): AsyncIterable<ChatChunk> {
        requests.push(request);
        if (requests.length === 1) {
          yield { type: "text", text: "等待授权后检查目录" };
          return;
        }
        if (requests.length === 2) {
          entered();
          await held;
          yield {
            type: "tool_call",
            call: {
              id: "stale",
              name: "run_command",
              arguments: { program: "printf", args: ["STALE_SHOULD_NOT_RUN"] },
            },
          };
          return;
        }
        if (requests.length === 3)
          yield {
            type: "tool_call",
            call: {
              id: "fresh",
              name: "run_command",
              arguments: { program: "pwd", args: [] },
            },
          };
        else
          yield {
            type: "tool_call",
            call: {
              id: "finish",
              name: "finish_task",
              arguments: { summary: "已衔接人工输出并检查目录" },
            },
          };
      },
    });
    cleanup.push(() => {
      release();
      coordinator.stopAll();
    });
    const created = await coordinator.create("owner", {
      sessionId: t.id,
      requestId: mode,
      providerId: 1,
      model: "fixture",
      goal: "检查当前目录",
      mode,
      maxTurns: 6,
    });
    const human = { kind: "human" as const, userId: "owner" };
    const authorize = () =>
      runtime.authorize(human, created.task.id, {
        ...t.control.snapshot(),
        shellReady: true,
        policyRevision: 1,
        maxOperations: 4,
        durationMinutes: 2,
        allowReviewedPlan: false,
        matches: [
          { kind: "program", program: "pwd" },
          { kind: "program", program: "printf" },
        ],
      });
    await authorize();
    await ready;
    t.control.humanInput(
      Buffer.from(
        "printf 'MANUAL_%s\\n' HANDOFF_READY; api_key=fixture-secret-value; printf 'api_key=%s\\n' \"$api_key\"\r",
      ),
    );
    await vi.waitFor(() => expect(output).toContain("MANUAL_HANDOFF_READY"), {
      timeout: 10000,
    });
    await authorize();
    release();
    await vi.waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(3), {
      timeout: 10000,
    });
    const resumed = JSON.stringify(requests[2].messages);
    expect(resumed).toContain("MANUAL_HANDOFF_READY");
    expect(resumed).not.toContain("fixture-secret-value");
    expect(resumed).toContain("untrusted-terminal-output");
    if (mode === "collaborative") {
      await vi.waitFor(
        () =>
          expect(runtime.get(human, created.task.id).state).toBe(
            "awaiting-approval",
          ),
        { timeout: 10000 },
      );
      const op = runtime.get(human, created.task.id).operations.at(-1)!;
      await runtime.approve(human, created.task.id, op.id, op.digest, 1);
    }
    await vi.waitFor(
      () =>
        expect(coordinator.get("owner", created.run.id).phase).toBe(
          "completed",
        ),
      { timeout: 15000 },
    );
    expect(output).not.toContain("STALE_SHOULD_NOT_RUN");
    const operations = runtime.get(human, created.task.id).operations;
    expect(operations).toHaveLength(1);
    expect(operations[0].status).toBe("succeeded");
    expect(operations[0].output).toContain(f.root);
  },
  45000,
);

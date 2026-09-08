import { afterEach, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AiTaskCoordinator } from "../../ai/tasks/runner";
import type { ChatChunk, ChatRequest } from "../../ai/providers/types";
import { parentDirectoryWorkflowFixture } from "../../test-helpers/parent-directory-workflow-fixture";
const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});
const tool = (name: string, args: Record<string, unknown>): ChatChunk => ({
  type: "tool_call",
  call: { id: randomUUID(), name, arguments: args },
});
const reply = (request: ChatRequest, name: string) => {
  const m = request.messages
    .filter((m) => m.role === "tool" && m.toolName === name)
    .at(-1);
  return m ? JSON.parse(m.content) : undefined;
};
it.each(["automatic", "collaborative"] as const)(
  "AI runs a saved directory workflow in its %s parent without precomputed follow-up writes",
  async (mode) => {
    const f = await parentDirectoryWorkflowFixture();
    cleanup.push(f.close);
    let turns = 0;
    const requests: ChatRequest[] = [];
    const ai = new AiTaskCoordinator({
      tasks: f.runtime,
      workflows: f.workflows,
      transfers: f.automation,
      directories: f.directoryAutomation,
      validate: async () => ({ label: "测试模型" }),
      audit: async () => {},
      stream: async function* (_u, _p, r) {
        requests.push({ ...r, signal: undefined });
        if (++turns === 1) {
          yield { type: "text", text: "运行目录部署流程并核对结果。" };
          return;
        }
        const detail = reply(r, "get_workflow"),
          files = reply(r, "list_authorized_files"),
          preview = reply(r, "preview_workflow"),
          run = reply(r, "run_workflow");
        if (!detail) {
          yield tool("get_workflow", { workflowId: f.saved.id });
          return;
        }
        expect(detail.files.artifact.kind).toBe("directory");
        if (!files) {
          yield tool("list_authorized_files", {});
          return;
        }
        if (!preview) {
          const fileBindings = Object.fromEntries(
            files.files.map(
              (g: {
                direction: string;
                kind: string;
                id: string;
                version: string;
              }) => {
                expect(g.kind).toBe("directory");
                return [
                  g.direction === "upload" ? "artifact" : "result",
                  { localGrantId: g.id, localVersion: g.version },
                ];
              },
            ),
          );
          yield tool("preview_workflow", {
            workflowId: f.saved.id,
            parameters: {},
            fileBindings,
          });
          return;
        }
        if (!run) {
          yield tool("run_workflow", { previewId: preview.id });
          yield tool("run_command", { program: "pwd", args: [] });
          return;
        }
        expect(run.state).toBe("completed");
        expect(run.operations).toHaveLength(11);
        expect(reply(r, "run_command")).toMatchObject({
          status: "not-executed",
          reason: "WORKFLOW_RESULT_REVIEW_REQUIRED",
        });
        yield tool("finish_task", {
          summary: "目录上传、命令检查和下载均完成。",
        });
      },
    });
    const created = await ai.create("owner", {
      sessionId: f.sessionId,
      requestId: randomUUID(),
      goal: "运行目录部署流程",
      providerId: 1,
      model: "fixture",
      mode,
      maxTurns: 10,
    });
    cleanup.push(() => ai.stop("owner", created.run.id));
    await vi.waitFor(() =>
      expect(ai.get("owner", created.run.id).phase).toBe(
        "awaiting-authorization",
      ),
    );
    await f.bind(created.task.id);
    await f.authorize(created.task.id);
    if (mode === "collaborative")
      for (let i = 0; i < 11; i++) {
        await vi.waitFor(
          () =>
            expect(f.runtime.state(f.human, created.task.id).state).toBe(
              "awaiting-approval",
            ),
          { timeout: 10000 },
        );
        const op = f.runtime.get(f.human, created.task.id).operations.at(-1)!;
        await f.runtime.approve(f.human, created.task.id, op.id, op.digest, 1);
        await vi.waitFor(
          () =>
            expect(
              f.runtime.operation(f.human, created.task.id, op.id).status,
            ).toBe("succeeded"),
          { timeout: 10000 },
        );
      }
    await vi.waitFor(
      () => expect(ai.get("owner", created.run.id).phase).toBe("completed"),
      { timeout: 10000 },
    );
    expect(
      await fs.readFile(path.join(f.destination, "bundle", "data.bin")),
    ).toEqual(f.bytes);
    expect(f.writes).toEqual(["context", "pwd"]);
    expect(JSON.stringify(requests)).not.toContain(f.folder);
  },
  30000,
);

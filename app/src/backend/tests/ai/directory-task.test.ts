import { afterEach, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AiTaskCoordinator } from "../../ai/tasks/runner";
import type { ChatChunk, ChatRequest } from "../../ai/providers/types";
import { transferToolsFixture } from "../../test-helpers/transfer-tools-fixture";
const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const tool = (name: string, args: Record<string, unknown>): ChatChunk => ({
  type: "tool_call",
  call: { id: randomUUID(), name, arguments: args },
});
const reply = (r: ChatRequest, name: string) => {
  const m = r.messages
    .filter((m) => m.role === "tool" && m.toolName === name)
    .at(-1);
  return m ? JSON.parse(m.content) : undefined;
};
it.each([
  ["upload", "automatic"],
  ["upload", "collaborative"],
  ["download", "automatic"],
  ["download", "collaborative"],
] as const)(
  "built-in AI %s directory in %s mode waits for the batch and discards precomputed commands",
  async (direction, mode) => {
    const f = await transferToolsFixture();
    cleanup.push(f.close);
    const local = path.join(
      f.folder,
      direction === "upload" ? "source-tree" : "target-tree",
    );
    await fs.mkdir(local);
    if (direction === "upload") {
      await fs.mkdir(path.join(local, "空目录"));
      await fs.writeFile(path.join(local, "file.bin"), f.bytes);
    } else {
      await f.remote.mkdir("/srv/source-tree");
      await f.remote.mkdir("/srv/source-tree/空目录");
      await f.remote.write("/srv/source-tree/file.bin", f.bytes);
    }
    let turns = 0;
    const requests: ChatRequest[] = [];
    const ai = new AiTaskCoordinator({
      tasks: f.runtime,
      transfers: f.automation,
      directories: f.directoryAutomation,
      validate: async () => ({ label: "测试模型" }),
      audit: async () => {},
      stream: async function* (_u, _p, r) {
        requests.push({ ...r, signal: undefined });
        if (++turns === 1) {
          yield { type: "text", text: "预览目录，逐项传输并核对结果。" };
          return;
        }
        expect(r.tools.map((t) => t.name)).toEqual(
          expect.arrayContaining([
            "preview_directory_transfer",
            "get_directory_transfer",
            "run_directory_transfer",
            "get_directory_run",
            "release_directory_transfer",
          ]),
        );
        const listed = reply(r, "list_authorized_files"),
          preview = reply(r, "preview_directory_transfer"),
          page = reply(r, "get_directory_transfer"),
          run = reply(r, "run_directory_transfer"),
          state = reply(r, "get_directory_run"),
          released = reply(r, "release_directory_transfer");
        if (!listed) {
          yield tool("list_authorized_files", {});
          return;
        }
        if (!preview) {
          const g = listed.files[0];
          expect(g.kind).toBe("directory");
          yield tool("preview_directory_transfer", {
            direction,
            path: direction === "upload" ? "/srv" : "/srv/source-tree",
            localGrantId: g.id,
            localVersion: g.version,
          });
          return;
        }
        expect(preview.status).toBe("succeeded");
        const previewId = preview.fileResult.directoryTransfer.previewId;
        if (!page) {
          yield tool("get_directory_transfer", { previewId });
          return;
        }
        expect(page.entries).toBe(3);
        if (!run) {
          yield tool("run_directory_transfer", {
            previewId,
            revision: page.revision,
            choices: page.items.map((e: { id: string }) => ({
              id: e.id,
              action: "create",
            })),
          });
          yield tool("run_command", { program: "pwd", args: [] });
          return;
        }
        expect(run.state).toBe("completed");
        expect(run.completed).toBe(3);
        expect(reply(r, "run_command")).toMatchObject({
          status: "not-executed",
          reason: "DIRECTORY_RESULT_REVIEW_REQUIRED",
        });
        if (!state) {
          yield tool("get_directory_run", { runId: run.id });
          return;
        }
        expect(state.state).toBe("completed");
        if (!released) {
          yield tool("release_directory_transfer", { previewId });
          return;
        }
        yield tool("finish_task", { summary: "已传输目录并核对每项结果。" });
      },
    });
    const created = await ai.create("owner", {
      sessionId: f.sessionId,
      requestId: randomUUID(),
      goal: "传输整个目录",
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
    const ticket = f.grants.issue("owner", created.task.id, {
      windowToken: f.windowToken,
      direction,
      kind: "directory",
    });
    f.grants.claim(f.windowToken, ticket.id);
    await f.grants.fulfill(f.windowToken, ticket.id, [local]);
    await f.authorize(created.task.id);
    if (mode === "collaborative")
      for (const type of [
        "file.directory.preview",
        "file.directory.confirm",
        "file.directory.entry",
        "file.directory.entry",
        "file.directory.entry",
      ]) {
        await vi.waitFor(
          () =>
            expect(f.runtime.state(f.human, created.task.id).state).toBe(
              "awaiting-approval",
            ),
          { timeout: 10000 },
        );
        const op = f.runtime.get(f.human, created.task.id).operations.at(-1)!;
        expect(op.action.type).toBe(type);
        expect(op.fileResult).toBeUndefined();
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
    expect(f.runtime.get(f.human, created.task.id).operations).toHaveLength(5);
    if (direction === "upload")
      expect(await f.remote.read("/srv/source-tree/file.bin")).toEqual(f.bytes);
    else
      expect(
        await fs.readFile(path.join(local, "source-tree", "file.bin")),
      ).toEqual(f.bytes);
    expect(f.writes).toEqual(["context"]);
    expect(JSON.stringify(requests)).not.toContain(f.folder);
  },
  30000,
);

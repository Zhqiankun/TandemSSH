import { afterEach, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { AiTaskCoordinator } from "../../ai/tasks/runner";
import type { ChatChunk, ChatRequest } from "../../ai/providers/types";
import { transferToolsFixture } from "../../test-helpers/transfer-tools-fixture";
const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const tool = (
  name: string,
  arguments_: Record<string, unknown>,
): ChatChunk => ({
  type: "tool_call",
  call: { id: randomUUID(), name, arguments: arguments_ },
});
const reply = (r: ChatRequest, name: string) => {
  const m = r.messages
    .filter((m) => m.role === "tool" && m.toolName === name)
    .at(-1);
  return m ? JSON.parse(m.content) : undefined;
};
it.each(["automatic", "collaborative"] as const)(
  "built-in AI %s waits for transfer results before dependent actions",
  async (mode) => {
    const f = await transferToolsFixture();
    cleanup.push(f.close);
    if (mode === "automatic")
      vi.spyOn(f.automation, "release").mockImplementation(() => {
        throw Error("FILE_TRANSFER_CLEANUP_PENDING");
      });
    let turns = 0;
    const requests: ChatRequest[] = [];
    const ai = new AiTaskCoordinator({
      tasks: f.runtime,
      transfers: f.automation,
      validate: async () => ({ label: "测试模型" }),
      audit: async () => {},
      stream: async function* (_u, _p, r) {
        requests.push({ ...r, signal: undefined });
        if (++turns === 1) {
          yield { type: "text", text: "上传产物，执行检查，再下载结果。" };
          return;
        }
        expect(r.tools?.map((t) => t.name)).toEqual(
          expect.arrayContaining([
            "list_authorized_files",
            "upload_file",
            "download_file",
            "get_transfer_status",
            "release_transfer",
          ]),
        );
        const listed = reply(r, "list_authorized_files");
        if (!listed) {
          yield tool("list_authorized_files", {});
          return;
        }
        const upload = reply(r, "upload_file"),
          command = reply(r, "run_command"),
          download = reply(r, "download_file");
        if (!upload) {
          const g = listed.files.find(
            (g: { direction: string }) => g.direction === "upload",
          );
          yield tool("upload_file", {
            path: "/srv/data.bin",
            localGrantId: g.id,
            localVersion: g.version,
          });
          yield tool("run_command", { program: "pwd", args: [] });
          return;
        }
        expect(upload.status).toBe("succeeded");
        if (mode === "automatic")
          expect(upload.progressReleaseError).toBe(
            "FILE_TRANSFER_CLEANUP_PENDING",
          );
        if (command?.status !== "succeeded") {
          expect(command).toMatchObject({
            status: "not-executed",
            reason: "FILE_RESULT_REVIEW_REQUIRED",
          });
          yield tool("run_command", { program: "pwd", args: [] });
          return;
        }
        if (!download) {
          const g = listed.files.find(
            (g: { direction: string }) => g.direction === "download",
          );
          yield tool("download_file", {
            path: "/srv/data.bin",
            localGrantId: g.id,
            localVersion: g.version,
          });
          return;
        }
        expect(download.status).toBe("succeeded");
        expect(download.fileResult.transfer.verification).toBe("sha256");
        yield tool("finish_task", { summary: "已校验上传和下载内容。" });
      },
    });
    const created = await ai.create("owner", {
      sessionId: f.sessionId,
      requestId: randomUUID(),
      goal: "上传检查下载",
      providerId: 1,
      model: "fixture",
      mode,
      maxTurns: 8,
    });
    cleanup.push(() => ai.stop("owner", created.run.id));
    await vi.waitFor(() =>
      expect(ai.get("owner", created.run.id).phase).toBe(
        "awaiting-authorization",
      ),
    );
    await f.select(created.task.id);
    await f.authorize(created.task.id);
    if (mode === "collaborative")
      for (const type of ["file.upload", "terminal.command", "file.download"]) {
        await vi.waitFor(
          () =>
            expect(f.runtime.get(f.human, created.task.id).state).toBe(
              "awaiting-approval",
            ),
          { timeout: 10000 },
        );
        const op = f.runtime.get(f.human, created.task.id).operations.at(-1)!;
        expect(op.action.type).toBe(type);
        await f.runtime.approve(f.human, created.task.id, op.id, op.digest, 1);
      }
    await vi.waitFor(
      () => expect(ai.get("owner", created.run.id).phase).toBe("completed"),
      { timeout: 10000 },
    );
    expect(await fs.readFile(f.destination)).toEqual(f.bytes);
    expect(JSON.stringify(requests)).not.toContain(f.folder);
    expect(f.writes).toEqual(["context", "pwd"]);
  },
  30000,
);

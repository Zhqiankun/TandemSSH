import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { automatedFilesFixture } from "../../test-helpers/automated-files-fixture";
import { AiTaskCoordinator } from "../../ai/tasks/runner";
import type { ChatChunk, ChatRequest } from "../../ai/providers/types";
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((close) => close()));
const tool = (name: string, args: Record<string, unknown>): ChatChunk => ({
  type: "tool_call",
  call: { id: randomUUID(), name, arguments: args },
});
const reply = (request: ChatRequest, name: string) => {
  const message = request.messages
    .filter((m) => m.role === "tool" && m.toolName === name)
    .at(-1);
  return message ? JSON.parse(message.content) : undefined;
};
describe("built-in AI uses the file task gateway", () => {
  it.each(["automatic", "collaborative"] as const)(
    "%s mode waits for file results and never sends a masked secret back",
    async (mode) => {
      const f = automatedFilesFixture(
        "port=80\npassword=do-not-expose-value\n",
        mode,
      );
      cleanup.push(f.close);
      const requests: ChatRequest[] = [];
      const ai = new AiTaskCoordinator({
        files: f.files,
        tasks: f.runtime,
        validate: async () => ({ label: "本机测试模型" }),
        audit: async () => {},
        stream: async function* (userId, _provider, request) {
          expect(userId).toBe("owner");
          requests.push(structuredClone({ ...request, signal: undefined }));
          if (requests.length === 1) {
            expect(request.tools).toHaveLength(0);
            yield {
              type: "text",
              text: "读取配置，再精确修改端口，保留密码。",
            };
            return;
          }
          expect(request.tools?.map((t) => t.name)).toEqual(
            expect.arrayContaining([
              "list_directory",
              "stat_file",
              "read_file",
              "get_file_content",
              "propose_file_edit",
              "propose_file_write",
            ]),
          );
          const directory = reply(request, "list_directory"),
            attributes = reply(request, "stat_file");
          if (!directory) {
            yield tool("list_directory", { path: "/srv" });
            yield tool("stat_file", { path: "/srv/config" });
            return;
          }
          expect(directory.status).toBe("succeeded");
          expect(directory.fileResult.directory.entries[0].name).toBe("config");
          if (!attributes || attributes.status !== "succeeded") {
            expect(attributes).toMatchObject({
              status: "not-executed",
              reason: "FILE_RESULT_REVIEW_REQUIRED",
            });
            yield tool("stat_file", {
              path:
                directory.fileResult.directory.path +
                "/" +
                directory.fileResult.directory.entries[0].name,
            });
            return;
          }
          expect(attributes.fileResult.metadata.metadata.kind).toBe("file");
          const read = reply(request, "read_file"),
            edit = reply(request, "propose_file_edit");
          if (!read) {
            yield tool("read_file", {
              path: attributes.fileResult.metadata.canonicalPath,
            });
            return;
          }
          expect(read.status).toBe("succeeded");
          expect(read.body.content).not.toContain("do-not-expose-value");
          if (!edit) {
            yield tool("propose_file_edit", {
              version: read.body.document.version,
              edits: [{ before: "port=80", after: "port=81" }],
            });
            yield tool("run_command", { program: "reboot", args: [] });
            return;
          }
          expect(edit.status).toBe("succeeded");
          expect(reply(request, "run_command")).toMatchObject({
            status: "not-executed",
            reason: "FILE_RESULT_REVIEW_REQUIRED",
          });
          yield tool("finish_task", { summary: "端口已修改，秘密保持原样。" });
        },
      });
      const created = await ai.create("owner", {
        sessionId: f.control.snapshot().sessionId,
        requestId: randomUUID(),
        goal: "修改端口",
        providerId: 1,
        model: "fixture",
        mode,
        maxTurns: 8,
      });
      await vi.waitFor(() =>
        expect(ai.get("owner", created.run.id).phase).toBe(
          "awaiting-authorization",
        ),
      );
      await f.runtime.authorize(f.human, created.task.id, {
        ...f.control.snapshot(),
        policyRevision: 1,
        shellReady: true,
        maxOperations: 5,
        durationMinutes: 10,
        allowReviewedPlan: false,
        matches: [],
        fileScopes: [
          { kind: "directory", path: "/srv", access: ["read", "write"] },
        ],
      });
      if (mode === "collaborative") {
        for (const kind of [
          "file.list",
          "file.stat",
          "file.read",
          "file.write",
        ]) {
          await vi.waitFor(() =>
            expect(f.runtime.get(f.human, created.task.id).state).toBe(
              "awaiting-approval",
            ),
          );
          const op = f.runtime.get(f.human, created.task.id).operations.at(-1)!;
          expect(op.action.type).toBe(kind);
          let receipt: string | undefined;
          if (kind === "file.write") {
            expect(f.rows.get("/srv/config")!.bytes.toString()).toContain(
              "port=80",
            );
            receipt = f.files.review(f.human, created.task.id, op.id).reviewId;
          }
          await f.runtime.approve(
            f.human,
            created.task.id,
            op.id,
            op.digest,
            1,
            receipt,
          );
        }
      }
      await vi.waitFor(
        () => expect(ai.get("owner", created.run.id).phase).toBe("completed"),
        { timeout: 6000 },
      );
      expect(f.rows.get("/srv/config")!.bytes.toString()).toBe(
        "port=81\npassword=do-not-expose-value\n",
      );
      expect(f.writes).toEqual(["context"]);
      expect(JSON.stringify(requests)).not.toContain("do-not-expose-value");
      expect(requests).toHaveLength(6);
    },
    10000,
  );
});

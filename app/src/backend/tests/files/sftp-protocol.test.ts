import { describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import {
  OperationGateway,
  type FileExecutorPort,
} from "../../collaboration/operations/gateway";
import { SessionControl } from "../../collaboration/sessions/control";
import { DocumentService } from "../../files/document-service";
import { encodeDocument } from "../../files/encoding";
import type { FileDocumentContent } from "../../../types/file-document";
import { fileSftpFixture as fixture } from "../../test-helpers/file-sftp-fixture";
describe("real SSH/SFTP document protocol", () => {
  it("reads literal Unicode/percent filenames, stages chunks, refuses unsupported overwrite, and saves as a new path", async () => {
    const f = await fixture(),
      actor = { userId: "fixture", source: "human" as const };
    const service = new DocumentService({
      target: async () => ({
        key: "fixture",
        connection: "one",
        io: f.io,
        check: () => {},
      }),
      audit: async () => {},
      beginWrite: () => () => {},
    });
    try {
      const base = await service.read(actor, "session", "/目录/配置%2F.txt");
      expect(base.content).toBe("原始内容\n");
      expect(base.document.format?.lineEnding).toBe("crlf");
      const content = "中文行\n".repeat(10000),
        request = {
          sessionId: "session",
          path: base.path,
          version: base.document.version,
          content,
          requestId: randomUUID(),
        };
      await expect(service.save(actor, request)).rejects.toMatchObject({
        message: "FILE_ATOMIC_REPLACE_UNSUPPORTED",
        details: { commitMayHaveOccurred: false },
      });
      expect((await f.read(base.path)).toString()).toBe("原始内容\r\n");
      expect(f.renames()).toBe(0);
      const result = await service.save(actor, {
        ...request,
        requestId: randomUUID(),
        saveAs: "/目录/另存%2F.txt",
      });
      expect((await f.read(result.document.path)).toString()).toBe(
        content.replace(/\n/g, "\r\n"),
      );
      expect(result.bytes).toBe(
        Buffer.byteLength(content.replace(/\n/g, "\r\n")),
      );
      expect(f.writes()).toBeGreaterThan(4);
      expect(f.renames()).toBe(1);
      await expect(
        f.io.createExclusive(
          "/目录/另存%2F.txt",
          Buffer.from("bad"),
          undefined,
          () => {},
        ),
      ).rejects.toThrow();
    } finally {
      service.dispose();
      await f.close();
    }
  }, 20000);
});
describe("shared file gateway over real SFTP", () => {
  it.each(["automatic", "collaborative"] as const)(
    "%s mode reads and saves through the authorized file use case",
    async (mode) => {
      const f = await fixture(),
        taskId = randomUUID(),
        actor = { userId: "fixture", source: "agent" as const, taskId };
      let guard: (canonical?: string) => void = () => {
        throw Error("NO_EXECUTION_AUTHORITY");
      };
      let baseline: FileDocumentContent | undefined;
      const payload = "自动与协作\n".repeat(8000),
        terminalWrites: string[] = [];
      const control = new SessionControl(
        "session",
        {
          isReady: () => true,
          write: (bytes) => terminalWrites.push(Buffer.from(bytes).toString()),
        },
        () => {},
      );
      const lease = control.grant(
        { kind: "automation", ownerType: "agent-task", ownerId: taskId },
        control.snapshot(),
      );
      const service = new DocumentService({
        target: async () => ({
          key: "fixture",
          connection: "one",
          io: f.io,
          check: (_action, _path, canonical) => guard(canonical),
        }),
        audit: async () => {},
        beginWrite: () => () => {},
      });
      const files: FileExecutorPort = {
        prepare: async (action, operationId) => ({
          execute: async (authority) => {
            guard = authority;
            guard();
            if (action.type === "file.read") {
              baseline = await service.read(actor, "session", action.path);
              return {
                status: "succeeded",
                result: { document: baseline.document, contentAvailable: true },
              };
            }
            if (!baseline || action.version !== baseline.document.version)
              throw Error("BASELINE_MISMATCH");
            const encoded = encodeDocument(payload, action.format);
            if (
              action.contentHash !==
              createHash("sha256").update(encoded.bytes).digest("hex")
            )
              throw Error("PROPOSAL_CHANGED");
            const saved = await service.save(actor, {
              sessionId: "session",
              path: baseline.path,
              version: action.version,
              requestId: operationId,
              content: payload,
              saveAs: action.path,
            });
            return {
              status: "succeeded",
              result: { document: saved.document, bytes: saved.bytes },
            };
          },
          dispose: () => {
            guard = () => {
              throw Error("STALE_CONTROL");
            };
          },
        }),
      };
      const gateway = new OperationGateway(
        control,
        { hostId: "1", groupIds: [] },
        () => ({ revision: 1, sets: [] }),
        {
          prepare: async () => {
            throw Error("UNEXPECTED_TERMINAL_COMMAND");
          },
        },
        { append: async () => {} },
        Date.now,
        undefined,
        files,
      );
      gateway.authorizeTask(taskId, lease, {
        matches: [],
        fileScopes: [
          { kind: "directory", path: "/目录", access: ["read", "write"] },
        ],
        cwdScopes: ["/"],
        maxOperations: 2,
        expiresAt: Date.now() + 60000,
        expectedPolicyRevision: 1,
      });
      const context = (requestId: string) => ({
        taskId,
        requestId,
        mode,
        origin: "agent" as const,
        lease,
      });
      try {
        const read = await gateway.propose(context("read"), {
          type: "file.read",
          path: "/目录/配置%2F.txt",
        });
        if (mode === "collaborative") {
          await expect(gateway.dispatch(read.id)).rejects.toThrow(
            "APPROVAL_REQUIRED",
          );
          expect(baseline).toBeUndefined();
          gateway.approveOnce(read.id, read.digest, 1);
        }
        expect((await gateway.dispatch(read.id)).status).toBe("succeeded");
        expect(baseline!.content).toBe("原始内容\n");
        const encoded = encodeDocument(payload, baseline!.document.format!);
        const write = await gateway.propose(context("write"), {
          type: "file.write",
          path: "/目录/受控保存.txt",
          canonicalPath: "/目录/受控保存.txt",
          proposalId: randomUUID(),
          version: baseline!.document.version,
          contentHash: createHash("sha256").update(encoded.bytes).digest("hex"),
          bytes: encoded.bytes.length,
          format: baseline!.document.format!,
        });
        if (mode === "collaborative") {
          await expect(gateway.dispatch(write.id)).rejects.toThrow(
            "APPROVAL_REQUIRED",
          );
          expect(f.writes()).toBe(0);
          gateway.approveOnce(write.id, write.digest, 1);
        }
        const result = await gateway.dispatch(write.id);
        expect(result.status).toBe("succeeded");
        expect(result.exitCode).toBeUndefined();
        expect(result.fileResult?.bytes).toBe(encoded.bytes.length);
        expect((await f.read("/目录/受控保存.txt")).equals(encoded.bytes)).toBe(
          true,
        );
        expect(f.writes()).toBeGreaterThan(3);
        expect(terminalWrites).toEqual([]);
      } finally {
        control.close();
        service.dispose();
        await f.close();
      }
    },
    20000,
  );
});

import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { fileSftpFixture } from "../src/backend/test-helpers/file-sftp-fixture";
import { UploadService } from "../src/backend/files/upload-service";
import { UploadRecoveryStore } from "../src/backend/files/upload-recovery-store";
import { FilePathLocks } from "../src/backend/files/path-locks";
async function cleanupRoot(root: string, cache: string) {
  const actual = await fs.realpath(root);
  if (
    path.dirname(actual) !== (await fs.realpath(cache)) ||
    !path.basename(actual).startsWith("upload-process-")
  )
    throw Error("Cleanup scope");
  await fs.rm(actual, { recursive: true, force: true });
}
it("restores encrypted upload progress and revalidates the local file in a fresh process", async () => {
  const cache = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../.cache",
    ),
    root = await fs.mkdtemp(path.join(cache, "upload-process-")),
    source = path.join(root, "source.bin"),
    bytes = Buffer.alloc(4194304 + 77, 31),
    key = randomBytes(32),
    remote = await fileSftpFixture();
  let service: UploadService | undefined;
  try {
    await fs.writeFile(source, bytes);
    const stat = await fs.stat(source),
      manifest = {
        name: "source.bin",
        size: bytes.length,
        lastModified: Math.floor(stat.mtimeMs),
        hashes: [
          createHash("sha256").update(bytes.subarray(0, 4194304)).digest("hex"),
          createHash("sha256").update(bytes.subarray(4194304)).digest("hex"),
        ],
      };
    service = new UploadService({
      locks: new FilePathLocks(),
      target: async () => ({
        key: "process-target",
        connection: "old",
        acceptedHostKey: remote.peerKey(),
        hostScope: { userId: "owner", identity: "fixture" },
        io: remote.io,
        check: () => {},
      }),
      beginWrite: () => () => {},
      audit: async () => {},
    });
    const actor = { userId: "owner" },
      preview = await service.prepare(actor, {
        sessionId: "old",
        requestId: randomUUID(),
        path: "/process.bin",
        manifest,
      });
    await service.start(actor, preview.id, { overwrite: false });
    await service.chunk(actor, preview.id, 0, bytes.subarray(0, 4194304));
    await service.pause(actor, preview.id);
    const store = new UploadRecoveryStore(root, { load: async () => key });
    await service.suspend(actor, preview.id, async (c) => {
      await store.create("owner", c);
    });
    service.dispose();
    expect(() => service!.get(actor, preview.id)).toThrow("UPLOAD_NOT_FOUND");
    const worker = fileURLToPath(
        new URL("./test-helpers/upload-recovery-worker.mjs", import.meta.url),
      ),
      output = await new Promise<string>((resolve, reject) => {
        const child = execFile(
          process.execPath,
          ["--import", "tsx", worker],
          {
            cwd: path.resolve(path.dirname(worker), "../.."),
            windowsHide: true,
            timeout: 20000,
            maxBuffer: 1024 * 1024,
          },
          (e, out, err) => (e ? reject(Error(err || e.message)) : resolve(out)),
        );
        child.stdin!.end(
          JSON.stringify({
            root,
            cache,
            source,
            key: key.toString("hex"),
            recordId: preview.id,
            credentials: remote.credentials(),
            peer: remote.peerKey(),
          }),
        );
      });
    expect(JSON.parse(output)).toMatchObject({
      newProcess: true,
      newConnection: true,
      state: "completed",
      resumedAt: 4194304,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect((await remote.read("/process.bin")).equals(bytes)).toBe(true);
    expect((await store.get("owner", preview.id))?.state).toBe("completed");
  } finally {
    service?.dispose();
    await remote.close();
    await cleanupRoot(root, cache);
  }
}, 30000);

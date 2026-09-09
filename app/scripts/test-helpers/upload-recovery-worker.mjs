import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { UploadService } from "../../src/backend/files/upload-service.ts";
import { UploadRecoveryStore } from "../../src/backend/files/upload-recovery-store.ts";
import { FilePathLocks } from "../../src/backend/files/path-locks.ts";
import { SftpFileIO } from "../../src/backend/files/sftp-io.ts";
const require = createRequire(import.meta.url),
  { Client } = require("ssh2");
let raw = "";
for await (const chunk of process.stdin) {
  raw += chunk;
  if (raw.length > 2 * 1024 * 1024) throw Error("Input too large");
}
const p = JSON.parse(raw),
  root = await fs.realpath(p.root),
  cache = await fs.realpath(p.cache);
if (
  path.dirname(root) !== cache ||
  !path.basename(root).startsWith("upload-process-")
)
  throw Error("Worker scope");
const source = path.resolve(p.source);
if (path.dirname(source) !== root) throw Error("Source scope");
const bytes = await fs.readFile(source),
  stat = await fs.stat(source),
  manifest = {
    name: path.basename(source),
    size: bytes.length,
    lastModified: Math.floor(stat.mtimeMs),
    hashes: Array.from({ length: Math.ceil(bytes.length / 4194304) }, (_, i) =>
      createHash("sha256")
        .update(bytes.subarray(i * 4194304, (i + 1) * 4194304))
        .digest("hex"),
    ),
  };
const store = new UploadRecoveryStore(
    root,
    { load: async () => Buffer.from(p.key, "hex") },
    () => false,
  ),
  record = await store.claim("owner", p.recordId),
  client = new Client();
let service,
  peer,
  connected = false;
try {
  await new Promise((resolve, reject) => {
    client.once("ready", () => {
      connected = true;
      resolve();
    });
    client.once("error", reject);
    client.connect({
      ...p.credentials,
      hostVerifier: (bytes) => {
        peer =
          "SHA256:" +
          createHash("sha256")
            .update(bytes)
            .digest("base64")
            .replace(/=+$/, "");
        return peer === p.peer;
      },
    });
  });
  const sftp = await new Promise((resolve, reject) =>
      client.sftp((e, s) => (e ? reject(e) : resolve(s))),
    ),
    io = new SftpFileIO(sftp, 3000);
  service = new UploadService({
    locks: new FilePathLocks(),
    target: async () => ({
      key: "process-target",
      connection: "new-process",
      acceptedHostKey: peer,
      hostScope: { userId: "owner", identity: "fixture" },
      io,
      check: () => {
        if (!connected) throw Error("FILE_CONNECTION_CHANGED");
      },
    }),
    beginWrite: () => () => {},
    audit: async () => {},
  });
  const restored = await service.restore(
    { userId: "owner" },
    record.checkpoint,
    "new-session",
    manifest,
  );
  if (restored.state !== "paused" || restored.id === record.checkpoint.id)
    throw Error("Restored capability invalid");
  const resumed = await service.resume(
    { userId: "owner" },
    restored.id,
    "new-session",
  );
  if (resumed.state !== "uploading")
    throw Error(resumed.error || "Resume failed");
  for (
    let offset = resumed.receivedBytes;
    offset < bytes.length;
    offset += 4194304
  ) {
    const result = await service.chunk(
      { userId: "owner" },
      restored.id,
      offset,
      bytes.subarray(offset, Math.min(offset + 4194304, bytes.length)),
    );
    if (result.state !== "uploading")
      throw Error(result.error || "Chunk failed");
  }
  await store.transition("owner", p.recordId, record.claim.id, "committing");
  const result = await service.finish({ userId: "owner" }, restored.id);
  if (result.state !== "completed")
    throw Error(result.error || "Finish failed");
  await store.transition("owner", p.recordId, record.claim.id, "completed");
  console.log(
    JSON.stringify({
      newProcess: true,
      newConnection: true,
      state: result.state,
      resumedAt: restored.receivedBytes,
      sha256: result.sha256,
    }),
  );
} finally {
  service?.dispose();
  connected = false;
  client.end();
  client.destroy();
}

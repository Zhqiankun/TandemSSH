import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { DownloadService } from "../../src/backend/files/download-service.ts";
import { SftpFileIO } from "../../src/backend/files/sftp-io.ts";
const require = createRequire(import.meta.url),
  { Client } = require("ssh2"),
  { DownloadSink } = require("../../electron/download-sink.cjs");
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 2 * 1024 * 1024) throw Error("Input too large");
}
const p = JSON.parse(input),
  root = await fs.realpath(p.root),
  checkpointFile = path.resolve(p.checkpointFile);
if (
  path.dirname(root) !== (await fs.realpath(p.cache)) ||
  !path.basename(root).startsWith("download-recovery-") ||
  path.dirname(checkpointFile) !== root
)
  throw Error("Recovery test scope");
const checkpoint = JSON.parse(await fs.readFile(checkpointFile, "utf8")),
  client = new Client();
let connected = false,
  peer;
const sink = new DownloadSink();
let source;
try {
  await new Promise((resolve, reject) => {
    client.once("ready", () => {
      connected = true;
      resolve();
    });
    client.once("error", reject);
    client.connect({
      ...p.credentials,
      hostVerifier: (key) => {
        peer =
          "SHA256:" +
          createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
        return peer === p.peer;
      },
    });
  });
  const sftp = await new Promise((resolve, reject) =>
      client.sftp((e, s) => (e ? reject(e) : resolve(s))),
    ),
    io = new SftpFileIO(sftp, 3000);
  source = new DownloadService({
    target: async () => ({
      key: "fixture-key",
      connection: "new-process-connection",
      acceptedHostKey: peer,
      hostScope: { userId: "owner", identity: "fixture" },
      io,
      check: () => {
        if (!connected) throw Error("FILE_CONNECTION_CHANGED");
      },
    }),
    audit: async () => {},
  });
  const remote = await source.restore(
    { userId: "owner" },
    checkpoint.source,
    "new-session",
    randomUUID(),
  );
  const local = await sink.restore("new-window", checkpoint.local, {
    overwrite: false,
    source: remote,
    authorize: () => {
      if (!connected) throw Error("DOWNLOAD_CANCELLED");
    },
  });
  if (
    remote.id === checkpoint.source.id ||
    local.id === checkpoint.local.id ||
    local.state !== "paused"
  )
    throw Error("Old capability reused");
  await sink.resume("new-window", local.id);
  for (
    let offset = local.writtenBytes;
    offset < remote.size;
    offset += remote.chunkBytes
  )
    await sink.append(
      "new-window",
      local.id,
      offset,
      await source.chunk({ userId: "owner" }, remote.id, offset),
    );
  await source.verify({ userId: "owner" }, remote.id);
  const result = await sink.finish("new-window", local.id);
  console.log(
    JSON.stringify({
      state: result.state,
      sha256: result.sha256,
      resumedAt: local.writtenBytes,
      newCapabilities: true,
      realNewProcess: true,
    }),
  );
} finally {
  source?.dispose();
  await sink.reset("new-window");
  connected = false;
  client.end();
  client.destroy();
}

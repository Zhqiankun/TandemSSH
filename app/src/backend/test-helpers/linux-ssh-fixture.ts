import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID, createPrivateKey } from "node:crypto";
import ssh2 from "ssh2";
import type { Client, ClientChannel, SFTPWrapper } from "ssh2";
import { SftpFileIO } from "../files/sftp-io.js";
import {
  PtyCommandExecutor,
  quoteShellWord,
} from "../collaboration/adapters/pty-command.js";
import { SessionControl } from "../collaboration/sessions/control.js";
export interface LinuxManifest {
  id: string;
  host: string;
  port: number;
  user: string;
  password: string;
  privateKey: string;
  hostFingerprint: string;
  root: string;
  dir: string;
}
export function linuxManifest(): LinuxManifest {
  const name = process.env.TANDEM_LINUX_MANIFEST;
  if (!name) throw Error("TANDEM_LINUX_MANIFEST is required");
  const cache = fs.realpathSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../../.cache/linux-lab/runs",
      ),
    ),
    file = fs.realpathSync(name);
  if (
    !file.toLowerCase().startsWith(cache.toLowerCase() + path.sep) ||
    path.basename(file) !== "connection.json"
  )
    throw Error("Linux fixture manifest escaped project cache");
  const m = JSON.parse(fs.readFileSync(file, "utf8")) as LinuxManifest;
  if (
    m.host !== "127.0.0.1" ||
    m.user !== "alpine" ||
    m.root !== "/home/alpine/tandem-test" ||
    !Number.isInteger(m.port) ||
    m.port < 1 ||
    m.port > 65535 ||
    !/^SHA256:[A-Za-z0-9+/]+$/.test(m.hostFingerprint)
  )
    throw Error("Linux fixture identity invalid");
  if (
    path.basename(path.dirname(file)) !== m.id ||
    fs.realpathSync(m.privateKey) !==
      path.join(path.dirname(file), "client.pem")
  )
    throw Error("Linux fixture key escaped its run");
  return m;
}
export async function connectLinux(
  auth: "key" | "encrypted-key" | "password" = "key",
  password?: string,
): Promise<Client> {
  const m = linuxManifest(),
    client = new ssh2.Client();
  await new Promise<void>((resolve, reject) => {
    client.once("ready", resolve);
    client.once("error", (error) => {
      client.end();
      reject(error);
    });
    client.connect({
      host: m.host,
      port: m.port,
      username: m.user,
      readyTimeout: 15000,
      algorithms: { serverHostKey: ["rsa-sha2-512", "rsa-sha2-256"] },
      hostVerifier: (key) =>
        "SHA256:" +
          createHash("sha256")
            .update(key)
            .digest("base64")
            .replace(/=+$/, "") ===
        m.hostFingerprint,
      ...(auth === "key"
        ? { privateKey: fs.readFileSync(m.privateKey) }
        : auth === "encrypted-key"
          ? {
              privateKey: createPrivateKey(
                fs.readFileSync(m.privateKey),
              ).export({
                type: "pkcs1",
                format: "pem",
                cipher: "aes-256-cbc",
                passphrase: "linux-fixture-key-passphrase",
              }),
              passphrase: password ?? "linux-fixture-key-passphrase",
            }
          : { password: password ?? m.password, tryKeyboard: false }),
    });
  });
  return client;
}
export async function linuxExec(
  client: Client,
  command: string,
): Promise<{ code: number; output: string; error: string }> {
  return new Promise((resolve, reject) => {
    let channel: ClientChannel | undefined;
    let finished = false;
    let output = "",
      stderr = "",
      bytes = 0;
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      channel?.close();
      reject(error);
    };
    const timer = setTimeout(() => fail(Error("Linux command timeout")), 30000);
    client.exec(command, (error, stream) => {
      if (finished) {
        stream?.close();
        return;
      }
      if (error) {
        fail(error);
        return;
      }
      channel = stream;
      const append = (data: Buffer, isError: boolean) => {
        if (finished) return;
        bytes += data.length;
        if (bytes > 2 * 1024 * 1024) {
          fail(Error("Linux fixture output limit"));
          return;
        }
        if (isError) stderr += data.toString();
        else output += data.toString();
      };
      stream.on("data", (data: Buffer) => append(data, false));
      stream.stderr.on("data", (data: Buffer) => append(data, true));
      stream.on("error", fail);
      stream.on("close", (code: number) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({ code, output, error: stderr });
      });
    });
  });
}
export async function linuxFixture() {
  const manifest = linuxManifest(),
    client = await connectLinux(),
    root = manifest.root + "/case-" + randomUUID(),
    child = root + "/中文 ' quoted";
  const mkdir = await linuxExec(client, "mkdir -p -- " + quoteShellWord(child));
  if (mkdir.code !== 0) {
    client.end();
    throw Error("Linux fixture mkdir failed");
  }
  const sftp = await new Promise<SFTPWrapper>((resolve, reject) =>
      client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp))),
    ),
    io = new SftpFileIO(sftp, 15000),
    shells = new Set<ClientChannel>();
  const write = (name: string, bytes: string | Buffer) =>
    new Promise<void>((resolve, reject) => {
      const stream = sftp.createWriteStream(name);
      stream.once("error", reject);
      stream.once("close", () => resolve());
      stream.end(bytes);
    });
  const read = (name: string) =>
    new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const stream = sftp.createReadStream(name);
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 32 * 1024 * 1024) {
          stream.destroy();
          reject(Error("Linux read limit"));
          return;
        }
        chunks.push(chunk);
      });
      stream.once("error", reject);
      stream.once("end", () => resolve(Buffer.concat(chunks)));
    });
  const exists = (name: string) =>
    new Promise<boolean>((resolve, reject) =>
      sftp.lstat(name, (error) =>
        error
          ? (error as Error & { code?: number }).code === 2
            ? resolve(false)
            : reject(error)
          : resolve(true),
      ),
    );
  const terminal = async () => {
    const stream = await new Promise<ClientChannel>((resolve, reject) =>
      client.shell(
        { term: "xterm-256color", cols: 160, rows: 32 },
        (error, stream) => (error ? reject(error) : resolve(stream)),
      ),
    );
    shells.add(stream);
    let closed = false;
    stream.once("close", () => {
      closed = true;
      shells.delete(stream);
    });
    stream.on("error", () => {});
    const nonce = randomUUID(),
      marker = "\x1eTANDEM_READY:" + nonce + "\x1f";
    await new Promise<void>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => {
        stream.off("data", onData);
        reject(Error("Linux shell not ready"));
      }, 15000);
      function onData(bytes: Buffer) {
        output = (output + bytes.toString("utf8")).slice(-32768);
        if (output.includes(marker)) {
          clearTimeout(timer);
          stream.off("data", onData);
          resolve();
        }
      }
      stream.on("data", onData);
      stream.write(
        "cd " +
          quoteShellWord(root) +
          "; PS1='TANDEM_READY> '; export PS1; printf '\\036TANDEM_READY:" +
          nonce +
          "\\037'\r",
      );
    });
    const id = randomUUID(),
      control = new SessionControl(
        id,
        {
          isReady: () => !closed,
          write: (bytes) => stream.write(Buffer.from(bytes)),
        },
        () => {},
      ),
      executor = new PtyCommandExecutor(() => (closed ? null : stream), 15000);
    return { id, control, executor, stream };
  };
  let ended = false;
  return {
    manifest,
    client,
    sftp,
    io,
    root,
    child,
    write,
    read,
    exists,
    terminal,
    exec: (command: string) => linuxExec(client, command),
    async close() {
      if (ended) return;
      ended = true;
      for (const stream of shells) stream.close();
      if (!root.startsWith(manifest.root + "/case-"))
        throw Error("Linux cleanup scope");
      try {
        const result = await linuxExec(
          client,
          "rm -rf -- " + quoteShellWord(root),
        );
        if (result.code !== 0) throw Error("Linux fixture cleanup failed");
      } finally {
        client.end();
      }
    },
  };
}

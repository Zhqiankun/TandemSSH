import { generateKeyPairSync, randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ssh2Pkg from "ssh2";
import type {
  Client as SSHClient,
  SFTPWrapper,
  Session as ServerSession,
} from "ssh2";
const { Client, Server } = ssh2Pkg;
import { SftpFileIO } from "../files/sftp-io.js";
// Real loopback SSH/SFTP with a bounded workspace filesystem. POSIX ownership
// remains a modeled attribute on Windows; tests must not call this Linux proof.
export async function fileSftpFixture(
  options: {
    attachShell?: (session: ServerSession) => void | (() => void);
    beforeRead?: () => Promise<void>;
  } = {},
) {
  const shellClosers = new Set<() => void>();
  const workspace = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../..",
    ),
    cache = path.join(workspace, ".cache");
  await fs.mkdir(cache, { recursive: true });
  const directory = await fs.mkdtemp(path.join(cache, "file-sftp-"));
  const target = (remote: string) => {
    if (!remote.startsWith("/") || remote.includes("\0")) throw Error("path");
    const value = path.resolve(directory, "." + remote);
    if (value !== directory && !value.startsWith(directory + path.sep))
      throw Error("scope");
    return value;
  };
  await fs.mkdir(target("/目录"));
  await fs.writeFile(target("/目录/配置%2F.txt"), "原始内容\r\n");
  const key = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  }).privateKey.export({ type: "pkcs1", format: "pem" });
  const password = randomUUID();
  const modes = new Map<string, number>();
  const handles = new Map<
    number,
    { file: FileHandle; remote: string; mode: number }
  >();
  const directories = new Map<
    number,
    { remote: string; names: string[]; offset: number }
  >();
  let directoryReads = 0;
  let next = 0,
    writes = 0,
    renames = 0;
  const clients = new Set<SSHClient>();
  let acceptedConnections = 0;
  const server = new Server({ hostKeys: [key] }, (client) => {
    acceptedConnections++;
    client.on("error", () => {});
    client.on("authentication", (ctx) =>
      ctx.method === "password" &&
      ctx.username === "fixture" &&
      ctx.password === password
        ? ctx.accept()
        : ctx.reject(),
    );
    client.on("ready", () =>
      client.on("session", (accept) => {
        const session = accept();
        const closeShell = options.attachShell?.(session);
        if (closeShell) shellClosers.add(closeShell);
        session.on("exec", (acceptExec) => {
          const channel = acceptExec();
          channel.exit(127);
          channel.end();
        });
        session.on("sftp", (acceptSftp) => {
          const stream = acceptSftp();
          const run = (id: number, fn: () => Promise<void>) => {
            void fn().catch((e) =>
              stream.status(
                id,
                e?.code === "ENOENT" ? 2 : e?.code === "EACCES" ? 3 : 4,
              ),
            );
          };
          const get = (h: Buffer) => {
            const value = handles.get(h.readUInt32BE(0));
            if (!value) throw Error("handle");
            return value;
          };
          const attrs = async (
            remote: string,
            handle?: FileHandle,
            mode = modes.get(remote) ?? 0o100640,
          ) => {
            const s = handle
              ? await handle.stat()
              : await fs.lstat(target(remote));
            return {
              size: s.size,
              mode: s.isSymbolicLink()
                ? 0o120777
                : s.isDirectory()
                  ? 0o40000 | ((modes.get(remote) ?? 0o755) & 0o7777)
                  : mode,
              uid: 1000,
              gid: 1000,
              mtime: Math.floor(s.mtimeMs / 1000),
              atime: Math.floor(s.atimeMs / 1000),
            };
          };
          stream.on("REALPATH", (id: number, remote: string) =>
            run(id, async () => {
              const resolved = await fs.realpath(target(remote));
              if (
                resolved !== directory &&
                !resolved.startsWith(directory + path.sep)
              )
                throw Error("fixture escape");
              stream.name(id, [
                {
                  filename:
                    "/" +
                    path
                      .relative(directory, resolved)
                      .split(path.sep)
                      .join("/"),
                  longname: "",
                  attrs: await attrs(
                    "/" +
                      path
                        .relative(directory, resolved)
                        .split(path.sep)
                        .join("/"),
                  ),
                },
              ]);
            }),
          );
          stream.on("LSTAT", (id: number, remote: string) =>
            run(id, async () => {
              stream.attrs(id, await attrs(remote));
            }),
          );
          stream.on("OPENDIR", (id: number, remote: string) =>
            run(id, async () => {
              const names = await fs.readdir(target(remote));
              const n = ++next;
              directories.set(n, { remote, names, offset: 0 });
              const h = Buffer.alloc(4);
              h.writeUInt32BE(n);
              stream.handle(id, h);
            }),
          );
          stream.on("READDIR", (id: number, h: Buffer) =>
            run(id, async () => {
              directoryReads++;
              const value = directories.get(h.readUInt32BE(0));
              if (!value) throw Error("directory handle");
              const names = value.names.slice(value.offset, value.offset + 2);
              value.offset += names.length;
              if (!names.length) {
                stream.status(id, 1);
                return;
              }
              stream.name(
                id,
                await Promise.all(
                  names.map(async (name) => ({
                    filename: name,
                    longname: "",
                    attrs: await attrs(path.posix.join(value.remote, name)),
                  })),
                ),
              );
            }),
          );
          stream.on("OPEN", (id: number, remote: string, flags: number) =>
            run(id, async () => {
              const file = await fs.open(
                target(remote),
                flags & 8 ? "wx" : flags & 2 ? "r+" : "r",
              );
              const n = ++next;
              if (flags & 8) modes.set(remote, 0o100600);
              handles.set(n, {
                file,
                remote,
                mode: modes.get(remote) ?? 0o100640,
              });
              const h = Buffer.alloc(4);
              h.writeUInt32BE(n);
              stream.handle(id, h);
            }),
          );
          stream.on("FSTAT", (id: number, h: Buffer) =>
            run(id, async () => {
              const f = get(h);
              stream.attrs(id, await attrs(f.remote, f.file, f.mode));
            }),
          );
          stream.on(
            "READ",
            (id: number, h: Buffer, offset: number, length: number) =>
              run(id, async () => {
                await options.beforeRead?.();
                const b = Buffer.alloc(Math.min(length, 32768));
                const r = await get(h).file.read(b, 0, b.length, offset);
                if (r.bytesRead) stream.data(id, b.subarray(0, r.bytesRead));
                else stream.status(id, 1);
              }),
          );
          stream.on(
            "WRITE",
            (id: number, h: Buffer, offset: number, b: Buffer) =>
              run(id, async () => {
                writes++;
                const r = await get(h).file.write(b, 0, b.length, offset);
                if (r.bytesWritten !== b.length) throw Error("short write");
                stream.status(id, 0);
              }),
          );
          stream.on(
            "FSETSTAT",
            (
              id: number,
              h: Buffer,
              a: { mode?: number; uid?: number; gid?: number; size?: number },
            ) =>
              run(id, async () => {
                const f = get(h);
                if (a.mode !== undefined) {
                  f.mode = 0o100000 | a.mode;
                  modes.set(f.remote, f.mode);
                }
                if (a.size !== undefined) await f.file.truncate(a.size);
                if (a.uid !== undefined && a.uid !== 1000) throw Error("uid");
                if (a.gid !== undefined && a.gid !== 1000) throw Error("gid");
                stream.status(id, 0);
              }),
          );
          stream.on("CLOSE", (id: number, h: Buffer) =>
            run(id, async () => {
              if (directories.delete(h.readUInt32BE(0))) {
                stream.status(id, 0);
                return;
              }
              const f = get(h);
              await f.file.close();
              handles.delete(h.readUInt32BE(0));
              stream.status(id, 0);
            }),
          );
          stream.on(
            "MKDIR",
            (id: number, remote: string, attributes: { mode?: number }) =>
              run(id, async () => {
                await fs.mkdir(target(remote));
                modes.set(
                  remote,
                  0o40000 | ((attributes.mode ?? 0o755) & 0o7777),
                );
                stream.status(id, 0);
              }),
          );
          stream.on("REMOVE", (id: number, remote: string) =>
            run(id, async () => {
              await fs.unlink(target(remote));
              modes.delete(remote);
              stream.status(id, 0);
            }),
          );
          stream.on("RENAME", (id: number, from: string, to: string) =>
            run(id, async () => {
              try {
                await fs.lstat(target(to));
                throw Error("exists");
              } catch (e) {
                if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
              }
              await fs.rename(target(from), target(to));
              if (modes.has(from)) {
                modes.set(to, modes.get(from)!);
                modes.delete(from);
              }
              renames++;
              stream.status(id, 0);
            }),
          );
        });
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  let peerKey: string | undefined;
  const client = new Client();
  clients.add(client);
  client.on("error", () => {});
  await new Promise<void>((resolve, reject) => {
    client.once("ready", resolve);
    client.once("error", reject);
    client.connect({
      host: "127.0.0.1",
      port: (server.address() as { port: number }).port,
      username: "fixture",
      password,
      hostVerifier: (key) => {
        peerKey =
          "SHA256:" +
          createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
        return true;
      },
    });
  });
  const sftp = await new Promise<SFTPWrapper>((resolve, reject) =>
    client.sftp((e, s) => (e ? reject(e) : resolve(s))),
  );
  const io = new SftpFileIO(sftp, 3000);
  return {
    client,
    peerKey: () => peerKey,
    credentials: () => ({
      host: "127.0.0.1",
      port: (server.address() as { port: number }).port,
      username: "fixture",
      password,
    }),
    write: (p: string, body: string | Uint8Array) =>
      fs.writeFile(target(p), body),
    mkdir: (p: string) => fs.mkdir(target(p), { recursive: true }),
    symlinkDirectory: (link: string, destination: string) =>
      fs.symlink(
        target(destination),
        target(link),
        process.platform === "win32" ? "junction" : "dir",
      ),
    directoryReads: () => directoryReads,
    directoryHandles: () => directories.size,
    reconnect: async () => {
      const extra = new Client();
      clients.add(extra);
      extra.on("error", () => {});
      await new Promise<void>((resolve, reject) => {
        extra.once("ready", resolve);
        extra.once("error", reject);
        extra.connect({
          host: "127.0.0.1",
          port: (server.address() as { port: number }).port,
          username: "fixture",
          password,
          hostVerifier: () => true,
        });
      });
      const channel = await new Promise<SFTPWrapper>((resolve, reject) =>
        extra.sftp((e, s) => (e ? reject(e) : resolve(s))),
      );
      return { client: extra, io: new SftpFileIO(channel, 3000) };
    },
    connections: () => acceptedConnections,
    port: (server.address() as { port: number }).port,
    io,
    // Desktop fixtures can attach their shell to the same owned filesystem as SFTP.
    localPathForTest: (p: string) => target(p),
    read: (p: string) => fs.readFile(target(p)),
    writes: () => writes,
    renames: () => renames,
    close: async () => {
      for (const close of shellClosers) close();
      shellClosers.clear();
      sftp.end();
      for (const c of clients) c.destroy();
      await new Promise<void>((r) => server.close(() => r()));
      for (const h of handles.values()) await h.file.close().catch(() => {});
      handles.clear();
      directories.clear();
      const resolved = await fs.realpath(directory),
        parent = await fs.realpath(cache);
      if (
        !resolved.startsWith(parent + path.sep) ||
        !path.basename(resolved).startsWith("file-sftp-")
      )
        throw Error("cleanup scope");
      await fs.rm(resolved, { recursive: true, force: true });
    },
  };
}

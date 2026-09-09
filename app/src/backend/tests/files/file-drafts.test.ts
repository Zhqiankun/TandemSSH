import { afterEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  FileDraftStore,
  type DraftBinding,
  type DraftKeyPort,
} from "../../files/drafts/store";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== os.tmpdir() ||
      !path.basename(root).startsWith("tandem-drafts-test-")
    )
      throw Error("Cleanup scope");
    await fs.rm(root, { recursive: true, force: true });
  }
});
const binding: DraftBinding = {
  userId: "owner",
  targetKey: "owner:host",
  acceptedHostKey: "SHA256:trusted",
  hostIdentity: "user@127.0.0.1:22",
  path: "/secret-config.txt",
  canonicalPath: "/real-secret.txt",
};
const input = {
  original: "PASSWORD=original-sensitive",
  content: "API_KEY=edited-sensitive 中文",
  format: { charset: "utf8" as const, bom: false, lineEnding: "lf" as const },
};
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tandem-drafts-test-"));
  roots.push(root);
  const secrets = new Map<string, Buffer>();
  let available = true;
  const keys: DraftKeyPort = {
    load: async (user, create) => {
      if (!available) throw Error("unavailable");
      if (!secrets.has(user) && create) secrets.set(user, randomBytes(32));
      return secrets.get(user) ?? null;
    },
  };
  const files = async () => {
    const top = path.join(root, "tandem-drafts");
    const dirs = await fs.readdir(top);
    return (
      await Promise.all(
        dirs.map(async (d) =>
          (await fs.readdir(path.join(top, d))).map((f) =>
            path.join(top, d, f),
          ),
        ),
      )
    ).flat();
  };
  return {
    root,
    store: new FileDraftStore(root, keys),
    keys,
    secrets,
    files,
    unavailable: () => {
      available = false;
    },
  };
}
it("encrypts the complete snapshot and restores after recreating the store", async () => {
  const f = await fixture();
  expect(await f.store.read(binding)).toBeNull();
  const saved = await f.store.write(binding, input, null);
  const files = await f.files();
  expect(files).toHaveLength(1);
  const bytes = await fs.readFile(files[0]);
  for (const text of [
    input.original,
    input.content,
    binding.path,
    binding.hostIdentity,
  ])
    expect(bytes.includes(Buffer.from(text))).toBe(false);
  expect(path.basename(files[0])).toMatch(/^[a-f0-9]{64}\.draft$/);
  expect(await new FileDraftStore(f.root, f.keys).read(binding)).toEqual(saved);
});
it("separates app users, host keys and canonical targets", async () => {
  const f = await fixture();
  await f.store.write(binding, input, null);
  for (const changed of [
    { userId: "another" },
    { acceptedHostKey: "SHA256:changed" },
    { canonicalPath: "/elsewhere" },
    { targetKey: "other-host" },
  ])
    expect(await f.store.read({ ...binding, ...changed })).toBeNull();
});
it("never writes plaintext or rotates a missing original key", async () => {
  const f = await fixture();
  f.unavailable();
  await expect(f.store.write(binding, input, null)).rejects.toThrow(
    "FILE_DRAFT_ENCRYPTION_UNAVAILABLE",
  );
  expect(await f.files()).toHaveLength(0);
  const next = await fixture();
  await next.store.write(binding, input, null);
  const bytes = await fs.readFile((await next.files())[0]);
  next.secrets.clear();
  await expect(
    next.store.write(binding, { ...input, content: "changed" }, null),
  ).rejects.toThrow("FILE_DRAFT_KEY_MISSING");
  expect(next.secrets.size).toBe(0);
  expect(await fs.readFile((await next.files())[0])).toEqual(bytes);
});
it("rejects tampering and stale simultaneous writers without losing the winner", async () => {
  const f = await fixture(),
    first = await f.store.write(binding, input, null);
  const results = await Promise.allSettled([
    f.store.write(binding, { ...input, content: "winner" }, first.revision),
    f.store.write(binding, { ...input, content: "late" }, first.revision),
  ]);
  expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
  expect((await f.store.read(binding))?.content).toBe("winner");
  await expect(f.store.remove(binding, first.revision)).rejects.toThrow(
    "FILE_DRAFT_CONFLICT",
  );
  const file = (await f.files())[0],
    bytes = await fs.readFile(file);
  bytes[bytes.length - 1] ^= 1;
  await fs.writeFile(file, bytes);
  await expect(f.store.read(binding)).rejects.toThrow(
    "FILE_DRAFT_DECRYPT_FAILED",
  );
});
it("deletes only the current draft and rejects excessive content", async () => {
  const f = await fixture(),
    saved = await f.store.write(binding, input, null);
  await expect(
    f.store.write(
      binding,
      { ...input, content: "x".repeat(8 * 1024 * 1024 + 1) },
      saved.revision,
    ),
  ).rejects.toThrow("FILE_DRAFT_TOO_LARGE");
  expect((await f.store.read(binding))?.revision).toBe(saved.revision);
  await f.store.remove(binding, saved.revision);
  expect(await f.files()).toHaveLength(0);
});
it("rejects hardlinked and redirected generated files", async () => {
  const f = await fixture();
  await f.store.write(binding, input, null);
  const file = (await f.files())[0],
    outside = path.join(f.root, "link");
  await fs.link(file, outside);
  await expect(f.store.read(binding)).rejects.toThrow("FILE_DRAFT_INVALID");
  await fs.unlink(outside);
  const directory = path.dirname(file),
    moved = path.join(f.root, "relocated");
  if (
    !directory.startsWith(f.root + path.sep) ||
    path.dirname(moved) !== f.root
  )
    throw Error("Move scope");
  await fs.rename(directory, moved);
  await fs.symlink(
    moved,
    directory,
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(f.store.read(binding)).rejects.toThrow(
    "FILE_DRAFT_PATH_INVALID",
  );
});

it("counts abandoned encrypted temporary files against the storage limit", async () => {
  const f = await fixture(),
    saved = await f.store.write(binding, input, null),
    file = (await f.files())[0],
    orphan = path.join(
      path.dirname(file),
      "write-00000000-0000-4000-8000-000000000000.tmp",
    );
  await fs.writeFile(orphan, Buffer.from("TDF1"));
  await fs.truncate(orphan, 128 * 1024 * 1024);
  await expect(f.store.write(binding, input, saved.revision)).rejects.toThrow(
    "FILE_DRAFT_LIMIT",
  );
  expect((await f.store.read(binding))?.revision).toBe(saved.revision);
});

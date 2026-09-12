import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SFTPWrapper } from "ssh2";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSafeTrashSource,
  listTrash,
  moveToTrash,
  permanentlyDeleteTrashItem,
  restoreTrashItem,
} from "../../../hosts/file-manager/trash-service.js";

const temporaryDirectories: string[] = [];

// Junctions exercise directory-link traversal on Windows without requiring Developer Mode.
const directoryLinkType = process.platform === "win32" ? "junction" : "dir";
const canCreateSymlinks = (() => {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), "termix-symlink-probe-"));
  try {
    fs.mkdirSync(path.join(probe, "target"));
    fs.symlinkSync(
      path.join(probe, "target"),
      path.join(probe, "link"),
      directoryLinkType,
    );
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
})();

function localSftp(home: string): SFTPWrapper {
  const callback = <T>(
    promise: Promise<T>,
    done: (error: Error | undefined, value?: T) => void,
  ) =>
    promise
      .then((value) => done(undefined, value))
      .catch((error) => done(error));
  return {
    realpath(
      _target: string,
      done: (error: Error | undefined, value?: string) => void,
    ) {
      done(undefined, home);
    },
    stat(
      target: string,
      done: (error: Error | undefined, value?: fs.Stats) => void,
    ) {
      callback(fs.promises.stat(target), done);
    },
    lstat(
      target: string,
      done: (error: Error | undefined, value?: fs.Stats) => void,
    ) {
      callback(fs.promises.lstat(target), done);
    },
    readdir(
      target: string,
      done: (error: Error | undefined, value?: unknown[]) => void,
    ) {
      callback(
        fs.promises.readdir(target, { withFileTypes: true }).then((entries) =>
          entries.map((entry) => ({
            filename: entry.name,
            longname: entry.name,
            attrs: {},
          })),
        ),
        done,
      );
    },
    readFile(
      target: string,
      done: (error: Error | undefined, value?: Buffer) => void,
    ) {
      callback(fs.promises.readFile(target), done);
    },
    writeFile(target: string, data: string, done: (error?: Error) => void) {
      fs.promises
        .writeFile(target, data)
        .then(() => done())
        .catch(done);
    },
    rename(from: string, to: string, done: (error?: Error) => void) {
      fs.promises
        .rename(from, to)
        .then(() => done())
        .catch(done);
    },
    unlink(target: string, done: (error?: Error) => void) {
      fs.promises
        .unlink(target)
        .then(() => done())
        .catch(done);
    },
    mkdir(target: string, done: (error?: Error) => void) {
      fs.promises
        .mkdir(target)
        .then(() => done())
        .catch(done);
    },
    rmdir(target: string, done: (error?: Error) => void) {
      fs.promises
        .rmdir(target)
        .then(() => done())
        .catch(done);
    },
  } as unknown as SFTPWrapper;
}

async function fixture() {
  const home = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "termix-trash-"),
  );
  temporaryDirectories.push(home);
  return { home, sftp: localSftp(home) };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        fs.promises.rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe("file manager trash safety", () => {
  it("rejects roots and paths inside the trash", () => {
    expect(isSafeTrashSource("/", "/home/user/.termix-trash")).toBe(false);
    expect(isSafeTrashSource("C:/", "C:/Users/user/.termix-trash")).toBe(false);
    expect(
      isSafeTrashSource(
        "/home/user/.termix-trash/files/a",
        "/home/user/.termix-trash",
      ),
    ).toBe(false);
  });

  it("accepts ordinary files and directories", () => {
    expect(
      isSafeTrashSource("/home/user/report.txt", "/home/user/.termix-trash"),
    ).toBe(true);
  });

  it("moves, lists, and restores a file without changing its contents", async () => {
    const { home, sftp } = await fixture();
    const original = path.join(home, "report.txt");
    await fs.promises.writeFile(original, "important");

    const trashed = await moveToTrash(sftp, original);
    expect(fs.existsSync(original)).toBe(false);
    expect(await listTrash(sftp, 7)).toEqual([trashed]);

    await restoreTrashItem(sftp, trashed.id);
    expect(await fs.promises.readFile(original, "utf8")).toBe("important");
    expect(await listTrash(sftp, 7)).toEqual([]);
  });

  it("permanently deletes only the stored trash path", async () => {
    const { home, sftp } = await fixture();
    const original = path.join(home, "folder");
    await fs.promises.mkdir(original);
    await fs.promises.writeFile(path.join(original, "nested.txt"), "data");
    const trashed = await moveToTrash(sftp, original);

    await permanentlyDeleteTrashItem(sftp, trashed.id);
    expect(await listTrash(sftp, 7)).toEqual([]);
  });

  it.skipIf(!canCreateSymlinks)(
    "does not follow directory symlinks during permanent deletion",
    async () => {
      const { home, sftp } = await fixture();
      const target = path.join(home, "target");
      const link = path.join(home, "link");
      await fs.promises.mkdir(target);
      await fs.promises.writeFile(path.join(target, "keep.txt"), "keep");
      await fs.promises.symlink(target, link, directoryLinkType);

      const trashed = await moveToTrash(sftp, link);
      await permanentlyDeleteTrashItem(sftp, trashed.id);

      expect(
        await fs.promises.readFile(path.join(target, "keep.txt"), "utf8"),
      ).toBe("keep");
    },
  );

  it.each([".json", ".pending"])(
    "refuses tampered %s metadata instead of deleting an arbitrary path",
    async (suffix) => {
      const { home, sftp } = await fixture();
      const original = path.join(home, "discard.txt");
      const protectedFile = path.join(home, "keep.txt");
      await fs.promises.writeFile(original, "discard");
      await fs.promises.writeFile(protectedFile, "keep");
      const trashed = await moveToTrash(sftp, original);
      const metadata = path.join(
        home,
        ".termix-trash",
        "info",
        `${trashed.id}.json`,
      );
      const data = JSON.parse(await fs.promises.readFile(metadata, "utf8"));
      data.trashPath = protectedFile;
      await fs.promises.writeFile(metadata, JSON.stringify(data));
      if (suffix === ".pending")
        await fs.promises.rename(
          metadata,
          path.join(path.dirname(metadata), trashed.id + suffix),
        );

      await expect(
        permanentlyDeleteTrashItem(sftp, trashed.id),
      ).rejects.toThrow("Invalid trash metadata");
      expect(await fs.promises.readFile(protectedFile, "utf8")).toBe("keep");
    },
  );

  it("prunes items after the configured retention period", async () => {
    const { home, sftp } = await fixture();
    const original = path.join(home, "old.txt");
    await fs.promises.writeFile(original, "old");
    const trashed = await moveToTrash(sftp, original);
    const metadata = path.join(
      home,
      ".termix-trash",
      "info",
      `${trashed.id}.json`,
    );
    const data = JSON.parse(await fs.promises.readFile(metadata, "utf8"));
    data.deletedAt = "2020-01-01T00:00:00.000Z";
    await fs.promises.writeFile(metadata, JSON.stringify(data));

    expect(await listTrash(sftp, 7)).toEqual([]);
    expect(
      fs.existsSync(path.join(home, ".termix-trash", "files", trashed.id)),
    ).toBe(false);
  });
});

it.skipIf(!canCreateSymlinks)(
  "keeps a dangling directory link visible and restores the link itself",
  async () => {
    const { home, sftp } = await fixture();
    const target = path.join(home, "gone"),
      link = path.join(home, "dangling");
    await fs.promises.mkdir(target);
    await fs.promises.symlink(target, link, directoryLinkType);
    const originalTarget = await fs.promises.readlink(link);
    await fs.promises.rmdir(target);
    const item = await moveToTrash(sftp, link);
    expect(await listTrash(sftp, 7)).toEqual([item]);
    await restoreTrashItem(sftp, item.id);
    expect((await fs.promises.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await fs.promises.readlink(link)).toBe(originalTarget);
    expect(fs.existsSync(target)).toBe(false);
  },
);
it.skipIf(!canCreateSymlinks)(
  "permanently removes dangling links rather than leaving orphaned trash entries",
  async () => {
    const { home, sftp } = await fixture();
    const target = path.join(home, "gone"),
      link = path.join(home, "dangling");
    await fs.promises.mkdir(target);
    await fs.promises.symlink(target, link, directoryLinkType);
    await fs.promises.rmdir(target);
    const item = await moveToTrash(sftp, link);
    await permanentlyDeleteTrashItem(sftp, item.id);
    await expect(
      fs.promises.lstat(path.join(home, ".termix-trash/files", item.id)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await listTrash(sftp, 7)).toEqual([]);
  },
);
it.skipIf(!canCreateSymlinks)(
  "refuses to restore over an existing dangling link",
  async () => {
    const { home, sftp } = await fixture();
    const original = path.join(home, "original"),
      target = path.join(home, "gone");
    await fs.promises.writeFile(original, "important");
    const item = await moveToTrash(sftp, original);
    await fs.promises.mkdir(target);
    await fs.promises.symlink(target, original, directoryLinkType);
    await fs.promises.rmdir(target);
    await expect(restoreTrashItem(sftp, item.id)).rejects.toThrow(
      "already exists",
    );
    expect((await fs.promises.lstat(original)).isSymbolicLink()).toBe(true);
    expect(
      await fs.promises.readFile(
        path.join(home, ".termix-trash/files", item.id),
        "utf8",
      ),
    ).toBe("important");
  },
);
it("does not treat permission denial as a missing restore destination", async () => {
  const { home, sftp } = await fixture();
  const original = path.join(home, "original");
  await fs.promises.writeFile(original, "important");
  const item = await moveToTrash(sftp, original);
  const base = sftp.lstat.bind(sftp);
  sftp.lstat = (target, callback) => {
    if (target === original)
      callback(
        Object.assign(Error("permission denied"), { code: 3 }),
        undefined as never,
      );
    else base(target, callback);
  };
  await expect(restoreTrashItem(sftp, item.id)).rejects.toThrow(
    "permission denied",
  );
  expect(
    await fs.promises.readFile(
      path.join(home, ".termix-trash/files", item.id),
      "utf8",
    ),
  ).toBe("important");
});

it("does not move a source cancelled during its inspection", async () => {
  const { home, sftp } = await fixture();
  const original = path.join(home, "cancelled.txt");
  await fs.promises.writeFile(original, "keep");
  let cancelled = false,
    renames = 0;
  const stat = sftp.lstat.bind(sftp),
    rename = sftp.rename.bind(sftp);
  sftp.lstat = (target, done) =>
    stat(target, (error, value) => {
      if (target === original) cancelled = true;
      done(error, value);
    });
  sftp.rename = (from, to, done) => {
    renames++;
    rename(from, to, done);
  };
  await expect(
    moveToTrash(sftp, original, () => {
      if (cancelled) throw Error("cancelled");
    }),
  ).rejects.toThrow("cancelled");
  expect(renames).toBe(0);
  expect(await fs.promises.readFile(original, "utf8")).toBe("keep");
  expect(await listTrash(sftp, 7)).toEqual([]);
});

it("finishes recovery metadata when cancellation follows the source move", async () => {
  const { home, sftp } = await fixture();
  const original = path.join(home, "moved.txt");
  await fs.promises.writeFile(original, "recoverable");
  let cancelled = false;
  const rename = sftp.rename.bind(sftp);
  sftp.rename = (from, to, done) =>
    rename(from, to, (error) => {
      if (!error) cancelled = true;
      done(error);
    });
  const item = await moveToTrash(sftp, original, () => {
    if (cancelled) throw Error("cancelled");
  });
  expect(cancelled).toBe(true);
  expect(await listTrash(sftp, 7)).toEqual([item]);
  await restoreTrashItem(sftp, item.id);
  expect(await fs.promises.readFile(original, "utf8")).toBe("recoverable");
});

it("does not move the source when recovery intent cannot be written", async () => {
  const { home, sftp } = await fixture();
  const source = path.join(home, "source.txt");
  await fs.promises.writeFile(source, "keep");
  const rename = vi.fn(sftp.rename.bind(sftp));
  const failing = {
    ...sftp,
    rename,
    writeFile: (_path: string, _data: string, done: (error?: Error) => void) =>
      done(Error("metadata denied")),
  } as unknown as SFTPWrapper;
  await expect(moveToTrash(failing, source)).rejects.toThrow("metadata denied");
  expect(rename).not.toHaveBeenCalled();
  expect(await fs.promises.readFile(source, "utf8")).toBe("keep");
});

it.each(["source", "publication"] as const)(
  "recovers after the %s rename acknowledgement is lost",
  async (phase) => {
    const { home, sftp } = await fixture();
    const source = path.join(home, "source.txt");
    await fs.promises.writeFile(source, "recover");
    const unreliable = {
      ...sftp,
      rename: (from: string, to: string, done: (error?: Error) => void) => {
        sftp.rename(from, to, (error) => {
          const lose =
            phase === "source" ? from === source : from.endsWith(".pending");
          done(error || (lose ? Error("response lost") : undefined));
        });
      },
    } as unknown as SFTPWrapper;
    await expect(moveToTrash(unreliable, source)).rejects.toThrow(
      "response lost",
    );
    expect(fs.existsSync(source)).toBe(false);
    const items = await listTrash(sftp, 7);
    expect(items).toHaveLength(1);
    await restoreTrashItem(sftp, items[0].id);
    expect(await fs.promises.readFile(source, "utf8")).toBe("recover");
    expect(
      await fs.promises.readdir(path.join(home, ".termix-trash", "info")),
    ).toEqual([]);
  },
);

it("restores directly from pending metadata when publication fails before applying", async () => {
  const { home, sftp } = await fixture();
  const source = path.join(home, "source.txt");
  await fs.promises.writeFile(source, "recover");
  const blocked = {
    ...sftp,
    rename: (from: string, to: string, done: (error?: Error) => void) => {
      if (from.endsWith(".pending")) done(Error("publication denied"));
      else sftp.rename(from, to, done);
    },
  } as unknown as SFTPWrapper;
  await expect(moveToTrash(blocked, source)).rejects.toThrow(
    "publication denied",
  );
  const entries = await fs.promises.readdir(
    path.join(home, ".termix-trash", "info"),
  );
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatch(/.pending$/);
  const [item] = await listTrash(sftp, 7);
  expect(item.originalPath).toBe(source);
  await restoreTrashItem(sftp, item.id);
  expect(await fs.promises.readFile(source, "utf8")).toBe("recover");
});

it("a concurrent listing does not discard intent before the source move", async () => {
  const { home, sftp } = await fixture();
  const source = path.join(home, "source.txt");
  await fs.promises.writeFile(source, "keep");
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = {
    ...sftp,
    writeFile: (
      target: string,
      data: string,
      done: (error?: Error) => void,
    ) => {
      sftp.writeFile(target, data, (error) => {
        if (error) return done(error);
        entered();
        void gate.then(() => done());
      });
    },
  } as unknown as SFTPWrapper;
  const moving = moveToTrash(held, source);
  await reached;
  expect(await listTrash(sftp, 7)).toEqual([]);
  expect(
    (await fs.promises.readdir(path.join(home, ".termix-trash", "info")))[0],
  ).toMatch(/.pending$/);
  release();
  const item = await moving;
  expect(await listTrash(sftp, 7)).toEqual([item]);
  await restoreTrashItem(sftp, item.id);
  expect(await fs.promises.readFile(source, "utf8")).toBe("keep");
});

it("retention removes abandoned intent without touching the unmoved source", async () => {
  const { home, sftp } = await fixture();
  const source = path.join(home, "source.txt");
  await fs.promises.writeFile(source, "keep");
  let cancelled = false;
  const stopped = {
    ...sftp,
    writeFile: (
      target: string,
      data: string,
      done: (error?: Error) => void,
    ) => {
      sftp.writeFile(target, data, (error) => {
        cancelled = true;
        done(error);
      });
    },
  } as unknown as SFTPWrapper;
  await expect(
    moveToTrash(stopped, source, () => {
      if (cancelled) throw Error("cancelled");
    }),
  ).rejects.toThrow("cancelled");
  const info = path.join(home, ".termix-trash", "info");
  const [name] = await fs.promises.readdir(info);
  const record = JSON.parse(
    await fs.promises.readFile(path.join(info, name), "utf8"),
  );
  record.deletedAt = new Date(Date.now() - 8 * 86400000).toISOString();
  await fs.promises.writeFile(path.join(info, name), JSON.stringify(record));
  expect(await listTrash(sftp, 7)).toEqual([]);
  expect(await fs.promises.readdir(info)).toEqual([]);
  expect(await fs.promises.readFile(source, "utf8")).toBe("keep");
});

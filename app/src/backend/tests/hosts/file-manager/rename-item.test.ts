import { expect, it, vi } from "vitest";
import type { SFTPWrapper } from "ssh2";
import {
  renameFileItem,
  moveFileItem,
} from "../../../hosts/file-manager/rename-item.js";
function fixture(targetExists = false, race = false) {
  const files = new Map([["/srv/source", "source"]]);
  if (targetExists) files.set("/srv/target", "existing");
  const rename = vi.fn(
    (old: string, next: string, done: (e?: Error) => void) => {
      if (race) files.set(next, "racing");
      if (files.has(next))
        return done(Object.assign(Error("exists"), { code: 4 }));
      files.set(next, files.get(old)!);
      files.delete(old);
      done();
    },
  );
  const sftp = {
    lstat: vi.fn((p: string, done: (e: unknown, v?: unknown) => void) =>
      files.has(p)
        ? done(null, {})
        : done(Object.assign(Error("missing"), { code: 2 })),
    ),
    rename,
  } as unknown as SFTPWrapper;
  return { sftp, files, rename };
}
it("renames literal names through SFTP without shell evaluation", async () => {
  const f = fixture();
  const name = "中文;$(x)\n.txt";
  expect(await renameFileItem(f.sftp, "/srv/source", name)).toBe(
    "/srv/" + name,
  );
  expect(f.files.get("/srv/" + name)).toBe("source");
});
it.each([false, true])(
  "preserves both entries on existing-target conflict, race=%s",
  async (race) => {
    const f = fixture(!race, race);
    await expect(
      renameFileItem(f.sftp, "/srv/source", "target"),
    ).rejects.toThrow("FILE_TARGET_EXISTS");
    expect(f.files.get("/srv/source")).toBe("source");
    expect(f.files.get("/srv/target")).toBe(race ? "racing" : "existing");
    expect(f.rename).toHaveBeenCalledTimes(race ? 1 : 0);
  },
);
it.each(["", ".", "..", "../outside", "a/b", "a\0b"])(
  "rejects invalid basename %j without mutation",
  async (name) => {
    const f = fixture();
    await expect(renameFileItem(f.sftp, "/srv/source", name)).rejects.toThrow(
      "INVALID_RENAME_PATH",
    );
    expect(f.rename).not.toHaveBeenCalled();
  },
);
it("treats the same existing path as a no-op", async () => {
  const f = fixture();
  await renameFileItem(f.sftp, "/srv/source", "source");
  expect(f.rename).not.toHaveBeenCalled();
});
it("does not report a conflict or retry after an unconfirmed rename response", async () => {
  const f = fixture();
  f.rename.mockImplementation((old, next, done) => {
    f.files.set(next, f.files.get(old)!);
    f.files.delete(old);
    done(Error("connection lost"));
  });
  await expect(renameFileItem(f.sftp, "/srv/source", "target")).rejects.toThrow(
    "RENAME_RESULT_UNKNOWN",
  );
  expect(f.rename).toHaveBeenCalledTimes(1);
});

it("moves to an explicit destination in a different directory", async () => {
  const f = fixture();
  expect(await moveFileItem(f.sftp, "/srv/source", "/other/new")).toBe(
    "/other/new",
  );
  expect(f.files.get("/other/new")).toBe("source");
  expect(f.files.has("/srv/source")).toBe(false);
});
it("does not fall back to destructive copying when the server refuses a move", async () => {
  const f = fixture();
  f.rename.mockImplementation((_old, _next, done) =>
    done(Object.assign(Error("cross-device"), { code: 4 })),
  );
  await expect(
    moveFileItem(f.sftp, "/srv/source", "/other/new"),
  ).rejects.toThrow("cross-device");
  expect(f.files.get("/srv/source")).toBe("source");
  expect(f.rename).toHaveBeenCalledTimes(1);
});

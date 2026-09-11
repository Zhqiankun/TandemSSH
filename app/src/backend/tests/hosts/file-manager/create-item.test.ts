import { expect, it, vi } from "vitest";
import type { SFTPWrapper } from "ssh2";
import {
  createFileItem,
  newItemPath,
} from "../../../hosts/file-manager/create-item.js";
function fixture(existing = false) {
  const entries = new Set(existing ? ["/target/name"] : []);
  const add = (
    target: string,
    done: (error?: Error | null, handle?: Buffer) => void,
  ) => {
    if (entries.has(target)) done(Object.assign(Error("exists"), { code: 4 }));
    else {
      entries.add(target);
      done(null, Buffer.from("handle"));
    }
  };
  const close = vi.fn((_handle: Buffer, done: (error?: Error) => void) =>
    done(),
  );
  const sftp = {
    open: (target: string, flags: string, done: Parameters<typeof add>[1]) => {
      expect(flags).toBe("wx");
      add(target, done);
    },
    mkdir: add,
    close,
    lstat: (
      target: string,
      done: (error?: Error | null, value?: unknown) => void,
    ) =>
      entries.has(target)
        ? done(null, {})
        : done(Object.assign(Error("missing"), { code: 2 })),
  } as unknown as SFTPWrapper;
  return { sftp, entries, close };
}
it.each(["file", "directory"] as const)(
  "creates a new %s and refuses an existing entry",
  async (kind) => {
    const f = fixture();
    await expect(createFileItem(f.sftp, "/target", "name", kind)).resolves.toBe(
      "/target/name",
    );
    await expect(
      createFileItem(f.sftp, "/target", "name", kind),
    ).rejects.toThrow("FILE_TARGET_EXISTS");
    expect(f.entries.size).toBe(1);
    expect(f.close).toHaveBeenCalledTimes(kind === "file" ? 1 : 0);
  },
);
it.each(["", ".", "..", "../escape", "name\0"])(
  "rejects invalid item name %j",
  (name) => {
    expect(() => newItemPath("/target", name)).toThrow("INVALID_CREATE_PATH");
  },
);
it("preserves literal POSIX names and normalizes Windows directories", () => {
  expect(newItemPath("/", "中文 '$()\n-file")).toBe("/中文 '$()\n-file");
  expect(newItemPath("C:\\target", "name")).toBe("C:/target/name");
  expect(() => newItemPath("C:/target", "..\\escape")).toThrow(
    "INVALID_CREATE_PATH",
  );
});
it("reports an unknown result if the exclusive create was acknowledged but close failed", async () => {
  const f = fixture();
  f.close.mockImplementation((_handle, done) => done(Error("lost")));
  await expect(
    createFileItem(f.sftp, "/target", "name", "file"),
  ).rejects.toThrow("CREATE_RESULT_UNKNOWN");
  expect(f.entries.has("/target/name")).toBe(true);
});
it("closes a handle acknowledged after timeout without claiming rollback", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    let done!: (error: null, handle: Buffer) => void;
    f.sftp.open = ((_path: string, _flags: string, callback: typeof done) => {
      done = callback;
    }) as SFTPWrapper["open"];
    const rejected = expect(
      createFileItem(f.sftp, "/target", "name", "file"),
    ).rejects.toThrow("CREATE_RESULT_UNKNOWN");
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    done(null, Buffer.from("late"));
    expect(f.close).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

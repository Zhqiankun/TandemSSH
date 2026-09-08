import { afterEach, expect, it } from "vitest";
import { fileSftpFixture } from "../../test-helpers/file-sftp-fixture";
const close: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of close.splice(0)) await fn();
});
it("reads multiple real SFTP directory packets, preserves Unicode names and closes the directory", async () => {
  const remote = await fileSftpFixture();
  close.push(remote.close);
  await remote.write("/目录/空 格.txt", "a");
  await remote.mkdir("/目录/子目录");
  const entries = await remote.io.list("/目录", 100, () => {});
  expect(entries.map((e) => e.name).sort()).toEqual(
    ["空 格.txt", "子目录", "配置%2F.txt"].sort(),
  );
  expect(entries.find((e) => e.name === "子目录")!.stat.kind).toBe("directory");
  expect(remote.directoryReads()).toBeGreaterThan(1);
  expect(remote.directoryHandles()).toBe(0);
  expect(remote.writes()).toBe(0);
  await remote.mkdir("/目录/空目录");
  expect(await remote.io.list("/目录/空目录", 100, () => {})).toEqual([]);
  expect(remote.directoryHandles()).toBe(0);
});
it("closes the owned SFTP directory after limits or cancellation stop enumeration", async () => {
  const remote = await fileSftpFixture();
  close.push(remote.close);
  await remote.write("/目录/另一个.txt", "b");
  await expect(remote.io.list("/目录", 1, () => {})).rejects.toThrow(
    "FILE_DIRECTORY_TOO_LARGE",
  );
  expect(remote.directoryHandles()).toBe(0);
  let checks = 0;
  await expect(
    remote.io.list("/目录", 100, () => {
      if (++checks === 3) throw Error("TAKEN_OVER");
    }),
  ).rejects.toThrow("TAKEN_OVER");
  expect(remote.directoryHandles()).toBe(0);
});

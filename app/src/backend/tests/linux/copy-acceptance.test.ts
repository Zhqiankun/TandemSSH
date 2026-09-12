import { expect, it } from "vitest";
import { linuxFixture } from "../../test-helpers/linux-ssh-fixture.js";
import { createCopyPlan } from "../../hosts/file-manager/copy-plan.js";
import { quoteShellWord } from "../../collaboration/adapters/pty-command.js";

it.runIf(!!process.env.TANDEM_LINUX_MANIFEST)(
  "copies over real SSH without replacing files, directories or live/broken links",
  async () => {
    const f = await linuxFixture();
    const link = (target: string, path: string) =>
      new Promise<void>((resolve, reject) =>
        f.sftp.symlink(target, path, (error) =>
          error ? reject(error) : resolve(),
        ),
      );
    try {
      const source = f.root + "/中文 ' $(touch injected)\n-file";
      const bytes = Buffer.from(
        Array.from({ length: 4096 }, (_, i) => i % 256),
      );
      await f.write(source, bytes);
      const directory = f.root + "/directory";
      expect((await f.exec("mkdir -- " + quoteShellWord(directory))).code).toBe(
        0,
      );
      await f.write(directory + "/child", bytes);
      await link("missing", directory + "/broken");
      const live = f.root + "/live";
      const broken = f.root + "/broken";
      await link(directory + "/child", live);
      await link("missing", broken);
      for (const [path, kind] of [
        [source, "file"],
        [directory, "directory"],
        [live, "symlink"],
        [broken, "symlink"],
      ] as const) {
        const plan = createCopyPlan(path, f.root);
        const result = await f.exec(plan.command);
        expect(result.code, result.output).toBe(0);
        expect((await f.io.stat(plan.targetPath)).kind).toBe(kind);
        if (kind === "file")
          expect(await f.read(plan.targetPath)).toEqual(bytes);
        if (kind === "directory") {
          expect(await f.read(plan.targetPath + "/child")).toEqual(bytes);
          expect((await f.io.stat(plan.targetPath + "/broken")).kind).toBe(
            "symlink",
          );
        }
        expect(await f.exists(plan.stagingPath)).toBe(false);
      }
      for (const path of [directory + "/child", directory]) {
        for (const targetKind of [
          "file",
          "directory",
          "live-link",
          "broken-link",
        ]) {
          const plan = createCopyPlan(path, f.root);
          if (targetKind === "file") await f.write(plan.targetPath, "keep");
          else if (targetKind === "directory") {
            expect(
              (await f.exec("mkdir -- " + quoteShellWord(plan.targetPath)))
                .code,
            ).toBe(0);
            await f.write(plan.targetPath + "/keep", "keep");
          } else
            await link(
              targetKind === "live-link" ? live : "missing",
              plan.targetPath,
            );
          const before = await f.io.stat(plan.targetPath);
          expect((await f.exec(plan.command)).code).toBe(73);
          expect(await f.io.stat(plan.targetPath)).toEqual(before);
          if (targetKind === "file")
            expect((await f.read(plan.targetPath)).toString()).toBe("keep");
          if (targetKind === "directory") {
            expect((await f.read(plan.targetPath + "/keep")).toString()).toBe(
              "keep",
            );
            expect(await f.exists(plan.targetPath + "/child")).toBe(false);
          }
          expect(await f.exists(plan.stagingPath)).toBe(false);
        }
      }
      const permissionSource = directory + "/child";
      expect(
        (await f.exec("chmod 751 -- " + quoteShellWord(permissionSource))).code,
      ).toBe(0);
      const permissionPlan = createCopyPlan(permissionSource, f.root);
      expect((await f.exec("umask 022\n" + permissionPlan.command)).code).toBe(
        0,
      );
      expect(
        (
          await f.exec(
            "stat -c %a -- " + quoteShellWord(permissionPlan.targetPath),
          )
        ).output.trim(),
      ).toBe("751");
      const race = createCopyPlan(directory, f.root);
      expect(
        (
          await f.exec(
            'mv() { printf "%s" other-writer > "$target"; command mv "$@"; }\n' +
              race.command,
          )
        ).code,
      ).toBe(73);
      expect((await f.read(race.targetPath)).toString()).toBe("other-writer");
      expect(await f.exists(race.stagingPath)).toBe(false);
      expect(await f.read(source)).toEqual(bytes);
      expect(await f.read(directory + "/child")).toEqual(bytes);
      expect(await f.exists(f.root + "/injected")).toBe(false);
    } finally {
      await f.close();
    }
  },
  120000,
);

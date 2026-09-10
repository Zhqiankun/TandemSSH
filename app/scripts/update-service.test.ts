import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const {
  UpdateService,
  validateUpdateInfo,
  FEED_URL,
} = require("../electron/update-service.cjs");
const info = {
  version: "0.1.0",
  files: [
    {
      url: "https://github.com/Zhqiankun/TandemSSH/releases/download/v0.1.0/TandemSSH-0.1.0-x64.exe",
      size: 2 * 1024 * 1024,
      sha512: createHash("sha512").update("fixture").digest("base64"),
    },
  ],
};
function fixture(installed = true) {
  const updater = Object.assign(new EventEmitter(), {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => ({
      updateInfo: structuredClone(info),
      isUpdateAvailable: true,
    })),
    downloadUpdate: vi.fn(async (_token: { cancelled: boolean }) => {}),
    quitAndInstall: vi.fn(),
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
  });
  class Token {
    cancelled = false;
    cancel() {
      this.cancelled = true;
    }
  }
  const open = vi.fn(async () => {}),
    before = vi.fn(async () => {});
  const service = new UpdateService({
    currentVersion: "0.1.0-alpha.0",
    packaged: true,
    installed,
    resolveFeed: async () => FEED_URL,
    loadUpdater: () => ({ autoUpdater: updater, CancellationToken: Token }),
    openRelease: open,
    beforeInstall: before,
  });
  return { service, updater, open, before };
}
describe("independent TandemSSH release channel", () => {
  it("pins the repository, verifies release metadata, and only downloads on request", async () => {
    const f = fixture();
    const state = await f.service.check();
    expect(state.status).toBe("available");
    expect(f.updater.setFeedURL).toHaveBeenCalledWith(
      expect.objectContaining({ url: FEED_URL }),
    );
    expect(f.updater.autoDownload).toBe(false);
    expect(f.updater.autoInstallOnAppQuit).toBe(false);
    expect(f.updater.allowDowngrade).toBe(false);
    expect(f.updater.downloadUpdate).not.toHaveBeenCalled();
    await f.service.download();
    expect(f.service.snapshot().status).toBe("downloaded");
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled();
    await f.service.install();
    expect(f.before).toHaveBeenCalledOnce();
    expect(f.updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });
  it("rejects a foreign repository, invalid digest and unversioned installer", () => {
    for (const mutate of [
      (v: typeof info) => {
        v.files[0].url = v.files[0].url.replace(
          "TandemSSH/releases",
          "Termix/releases",
        );
      },
      (v: typeof info) => {
        v.files[0].sha512 = "bad";
      },
      (v: typeof info) => {
        v.files[0].url = FEED_URL + "setup.exe";
      },
    ]) {
      const bad = structuredClone(info);
      mutate(bad);
      expect(() => validateUpdateInfo(bad)).toThrow("UPDATE_METADATA_INVALID");
    }
  });
  it("deduplicates checks and retains a downloaded update", async () => {
    const f = fixture();
    await Promise.all([f.service.check(), f.service.check()]);
    expect(f.updater.checkForUpdates).toHaveBeenCalledOnce();
    await f.service.download();
    await f.service.check();
    expect(f.updater.checkForUpdates).toHaveBeenCalledOnce();
  });
  it("reports cancellation without claiming a downloaded installer", async () => {
    const f = fixture();
    let finish!: () => void;
    f.updater.downloadUpdate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await f.service.check();
    const pending = f.service.download();
    await Promise.resolve();
    f.service.cancel();
    finish();
    await pending;
    expect(f.service.snapshot().status).toBe("available");
    expect(f.updater.listenerCount("download-progress")).toBe(0);
  });
  it("supports checks and fixed release links in portable mode, but prevents in-place installation", async () => {
    const f = fixture(false);
    expect((await f.service.check()).status).toBe("available");
    await expect(f.service.download()).rejects.toThrow(
      "UPDATE_INSTALLER_REQUIRED",
    );
    await expect(f.service.install()).rejects.toThrow("UPDATE_NOT_DOWNLOADED");
    await f.service.open();
    expect(f.open).toHaveBeenCalledWith(
      "https://github.com/Zhqiankun/TandemSSH/releases/tag/v0.1.0",
    );
  });
  it("distinguishes no published release from a successful version check", async () => {
    const f = fixture();
    f.updater.checkForUpdates.mockRejectedValue(Error("HTTP 404"));
    const state = await f.service.check();
    expect(state.status).toBe("error");
    expect(state.error).toBe("UPDATE_NOT_PUBLISHED");
  });
});

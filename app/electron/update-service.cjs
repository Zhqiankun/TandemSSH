const fs = require("node:fs");
const path = require("node:path");
const REPOSITORY = "Zhqiankun/TandemSSH";
const RELEASE_URL = "https://github.com/" + REPOSITORY + "/releases/latest";
const FEED_URL = RELEASE_URL + "/download/";
const INSTALL_MARKER = ".tandemssh-installed",
  INSTALL_ID = "app.tandemssh.desktop/v1";
function isInstalled(packaged, platform, executable) {
  if (!packaged || platform !== "win32") return false;
  try {
    return (
      fs
        .readFileSync(
          path.join(path.dirname(executable), INSTALL_MARKER),
          "utf8",
        )
        .trim() === INSTALL_ID
    );
  } catch {
    return false;
  }
}
function validateUpdateInfo(info) {
  const version = info?.version;
  if (
    typeof version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
    version.split(".").some((n) => !Number.isSafeInteger(Number(n)))
  )
    throw Error("UPDATE_METADATA_INVALID");
  const expected =
    "https://github.com/" +
    REPOSITORY +
    "/releases/download/v" +
    version +
    "/TandemSSH-" +
    version +
    "-x64.exe";
  const files = info.files;
  if (!Array.isArray(files) || files.length !== 1)
    throw Error("UPDATE_METADATA_INVALID");
  const file = files[0];
  if (
    file.url !== expected ||
    !Number.isSafeInteger(file.size) ||
    file.size < 1024 * 1024 ||
    file.size > 2 * 1024 * 1024 * 1024 ||
    typeof file.sha512 !== "string" ||
    !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512) ||
    Buffer.from(file.sha512, "base64").toString("base64") !== file.sha512 ||
    (info.path !== undefined && info.path !== expected) ||
    (info.sha512 !== undefined && info.sha512 !== file.sha512)
  )
    throw Error("UPDATE_METADATA_INVALID");
  return {
    version,
    releaseUrl:
      "https://github.com/" + REPOSITORY + "/releases/tag/v" + version,
  };
}
class UpdateService {
  constructor({
    currentVersion,
    packaged,
    installed,
    loadUpdater = () => require("electron-updater"),
    openRelease,
    beforeInstall = async () => {},
  }) {
    this.loadUpdater = loadUpdater;
    this.openRelease = openRelease;
    this.beforeInstall = beforeInstall;
    this.packaged = packaged;
    this.state = {
      currentVersion,
      installed,
      status: packaged ? "idle" : "unsupported",
      releaseUrl: RELEASE_URL,
    };
  }
  snapshot() {
    return structuredClone(this.state);
  }
  configured() {
    if (!this.packaged) throw Error("UPDATE_UNSUPPORTED");
    if (!this.module) {
      this.module = this.loadUpdater();
      const updater = this.module.autoUpdater;
      updater.setFeedURL({
        provider: "generic",
        url: FEED_URL,
        channel: "latest",
        useMultipleRangeRequest: false,
      });
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.allowPrerelease = false;
      updater.allowDowngrade = false;
      updater.disableWebInstaller = true;
      updater.on("error", () => {
        if (this.state.status === "installing")
          this.state = {
            ...this.state,
            status: "error",
            error: "UPDATE_INSTALL_FAILED",
          };
      });
    }
    return this.module;
  }
  check() {
    if (["downloading", "downloaded", "installing"].includes(this.state.status))
      return Promise.resolve(this.snapshot());
    if (this.pendingCheck) return this.pendingCheck;
    const pending = this.performCheck().finally(() => {
      if (this.pendingCheck === pending) this.pendingCheck = undefined;
    });
    this.pendingCheck = pending;
    return pending;
  }
  async performCheck() {
    try {
      const { autoUpdater } = this.configured();
      this.state = {
        ...this.state,
        status: "checking",
        error: undefined,
        progress: undefined,
      };
      const result = await autoUpdater.checkForUpdates();
      if (!result) throw Error("UPDATE_CHECK_FAILED");
      const latest = validateUpdateInfo(result.updateInfo);
      this.state = {
        ...this.state,
        status: result.isUpdateAvailable ? "available" : "current",
        latestVersion: latest.version,
        releaseUrl: latest.releaseUrl,
      };
      return this.snapshot();
    } catch (error) {
      const message = String(error?.message ?? "");
      this.state = {
        ...this.state,
        status: this.packaged ? "error" : "unsupported",
        error: /^UPDATE_[A-Z_]+$/.test(message)
          ? message
          : /404|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/.test(message)
            ? "UPDATE_NOT_PUBLISHED"
            : "UPDATE_CHECK_FAILED",
      };
      return this.snapshot();
    }
  }
  download() {
    if (this.pendingDownload) return this.pendingDownload;
    if (["downloaded", "installing"].includes(this.state.status))
      return Promise.resolve(this.snapshot());
    const pending = this.performDownload().finally(() => {
      if (this.pendingDownload === pending) this.pendingDownload = undefined;
    });
    this.pendingDownload = pending;
    return pending;
  }
  async performDownload() {
    if (!this.state.installed) throw Error("UPDATE_INSTALLER_REQUIRED");
    if (this.state.status !== "available") await this.check();
    if (this.state.status !== "available") return this.snapshot();
    const { autoUpdater, CancellationToken } = this.configured();
    this.token = new CancellationToken();
    const token = this.token;
    this.state = {
      ...this.state,
      status: "downloading",
      error: undefined,
      progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
    };
    const progress = (p) => {
      if (this.state.status !== "downloading") return;
      const bounded = (n) =>
        Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
      this.state.progress = {
        percent: Math.min(100, bounded(p.percent)),
        transferred: bounded(p.transferred),
        total: bounded(p.total),
        bytesPerSecond: bounded(p.bytesPerSecond),
      };
    };
    autoUpdater.on("download-progress", progress);
    try {
      await autoUpdater.downloadUpdate(token);
      if (token.cancelled) {
        this.state = {
          ...this.state,
          status: "available",
          progress: undefined,
        };
        return this.snapshot();
      }
      this.state = { ...this.state, status: "downloaded", progress: undefined };
      return this.snapshot();
    } catch {
      this.state = {
        ...this.state,
        status: token.cancelled ? "available" : "error",
        error: token.cancelled ? undefined : "UPDATE_DOWNLOAD_FAILED",
        progress: undefined,
      };
      return this.snapshot();
    } finally {
      autoUpdater.removeListener("download-progress", progress);
      if (this.token === token) this.token = undefined;
    }
  }
  cancel() {
    this.token?.cancel();
    return this.snapshot();
  }
  async install() {
    if (!this.state.installed || this.state.status !== "downloaded")
      throw Error("UPDATE_NOT_DOWNLOADED");
    await this.beforeInstall();
    this.state = { ...this.state, status: "installing", error: undefined };
    try {
      this.configured().autoUpdater.quitAndInstall(false, true);
    } catch {
      this.state = {
        ...this.state,
        status: "error",
        error: "UPDATE_INSTALL_FAILED",
      };
    }
    return this.snapshot();
  }
  async open() {
    await this.openRelease(RELEASE_URL);
    return this.snapshot();
  }
}
module.exports = {
  UpdateService,
  validateUpdateInfo,
  isInstalled,
  REPOSITORY,
  RELEASE_URL,
  FEED_URL,
  INSTALL_MARKER,
  INSTALL_ID,
};

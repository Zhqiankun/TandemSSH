const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { UpdateService, isInstalled } = require("./update-service.cjs");
function registerUpdateIpc({
  app,
  ipcMain,
  dialog,
  shell,
  getWindow,
  appRoot,
  isDev,
  beforeInstall,
}) {
  const service = new UpdateService({
    currentVersion: app.getVersion(),
    packaged: app.isPackaged && process.platform === "win32",
    installed: isInstalled(app.isPackaged, process.platform, process.execPath),
    openRelease: (url) => shell.openExternal(url),
    beforeInstall,
  });
  const expected = pathToFileURL(path.join(appRoot, "dist", "index.html")).href;
  let confirming = false;
  ipcMain.handle("tandem-update", async (event, action) => {
    try {
      const window = getWindow(),
        sender = event.sender;
      if (
        !window ||
        window.isDestroyed() ||
        sender !== window.webContents ||
        event.senderFrame !== sender.mainFrame
      )
        throw Error("UPDATE_TRUSTED_WINDOW_REQUIRED");
      const url = new URL(event.senderFrame.url);
      url.hash = "";
      url.search = "";
      if (
        isDev ? url.origin !== "http://localhost:5173" : url.href !== expected
      )
        throw Error("UPDATE_TRUSTED_WINDOW_REQUIRED");
      let value;
      if (action === "status") value = service.snapshot();
      else if (action === "auto-check-on" || action === "auto-check-off")
        value = service.setAutomaticChecks(action === "auto-check-on");
      else if (action === "install") {
        if (confirming || service.snapshot().status !== "downloaded")
          throw Error("UPDATE_NOT_DOWNLOADED");
        confirming = true;
        try {
          const result = await dialog.showMessageBox(window, {
            type: "question",
            title: "安装同舟 SSH 更新",
            message: "保存草稿并结束当前连接后安装更新？",
            detail:
              "安装将退出同舟 SSH，结束当前 SSH 连接与传输。请先保存需要保留的编辑内容。",
            buttons: ["取消", "现在安装"],
            defaultId: 0,
            cancelId: 0,
          });
          value =
            result.response === 1
              ? await service.install()
              : service.snapshot();
        } finally {
          confirming = false;
        }
      } else if (["check", "download", "cancel", "open"].includes(action))
        value = await service[action]();
      else throw Error("UPDATE_REQUEST_INVALID");
      return { ok: true, value };
    } catch (error) {
      const code =
        error instanceof Error && /^UPDATE_[A-Z_]+$/.test(error.message)
          ? error.message
          : "UPDATE_FAILED";
      return { ok: false, error: code };
    }
  });
  app.on("before-quit", () => service.dispose());
  return service;
}
module.exports = { registerUpdateIpc };

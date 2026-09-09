const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { UploadSourceStore, code } = require("./upload-sources.cjs");
function registerUploadSourceIpc({
  ipcMain,
  dialog,
  getWindow,
  appRoot,
  isDev,
  getBackend,
}) {
  const sources = new UploadSourceStore(),
    owners = new Set(),
    choosing = new Set();
  const recovery = getBackend
    ? require("./upload-recovery-window.cjs").createUploadRecoveryWindow(
        getBackend,
      )
    : undefined;
  const resetOwner = async (id) => {
    sources.reset(id);
    await recovery?.reset(id);
  };
  const expected = pathToFileURL(path.join(appRoot, "dist", "index.html")).href;
  function owner(event) {
    const window = getWindow(),
      sender = event.sender;
    if (
      !window ||
      window.isDestroyed() ||
      sender !== window.webContents ||
      event.senderFrame !== sender.mainFrame
    )
      throw Error("UPLOAD_TRUSTED_WINDOW_REQUIRED");
    const url = new URL(event.senderFrame.url);
    url.hash = "";
    url.search = "";
    if (isDev ? url.origin !== "http://localhost:5173" : url.href !== expected)
      throw Error("UPLOAD_TRUSTED_WINDOW_REQUIRED");
    if (!owners.has(sender.id)) {
      owners.add(sender.id);
      const reset = () => {
        void resetOwner(sender.id);
      };
      sender.once("destroyed", reset);
      sender.on("render-process-gone", reset);
      sender.on("did-start-navigation", (_e, _url, _inPlace, main) => {
        if (main) reset();
      });
    }
    return sender.id;
  }
  ipcMain.handle("tandem-upload-source", async (event, operation, ...args) => {
    try {
      const id = owner(event);
      let value;
      if (operation === "recovery-identity") {
        if (!recovery) throw Error("UPLOAD_RECOVERY_DESKTOP_REQUIRED");
        value = await recovery.identity(id);
      } else if (operation === "choose-directory") {
        if (choosing.has(id)) throw Error("UPLOAD_BUSY");
        choosing.add(id);
        const epoch = sources.epochs.get(id) ?? 0;
        try {
          const selected = await dialog.showOpenDialog(getWindow(), {
            title: "选择上传目录",
            buttonLabel: "选择目录",
            properties: ["openDirectory"],
          });
          if ((sources.epochs.get(id) ?? 0) !== epoch)
            throw Error("UPLOAD_CANCELLED");
          value = selected.canceled
            ? null
            : await sources.select(id, selected.filePaths);
        } finally {
          choosing.delete(id);
        }
      } else if (operation === "selected-files")
        value = await sources.select(id, args[0]);
      else if (operation === "check")
        value = await sources.check(id, args[0], args[1]);
      else if (operation === "chunk")
        value = await sources.chunk(id, args[0], args[1], args[2], args[3]);
      else if (operation === "forget") value = sources.forget(id, args[0]);
      else if (operation === "reset") {
        await resetOwner(id);
        value = null;
      } else throw Error("UPLOAD_REQUEST_INVALID");
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: code(error) };
    }
  });
  return {
    sources,
    dispose: () => {
      for (const owner of owners) void resetOwner(owner);
    },
  };
}
module.exports = { registerUploadSourceIpc };

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { LocalFileBrowser, errorCode } = require("./local-file-browser.cjs");
function registerLocalFileBrowserIpc({
  ipcMain,
  dialog,
  getWindow,
  appRoot,
  isDev,
  uploads,
  downloads,
}) {
  const browser = new LocalFileBrowser(),
    owners = new Map();
  const expected = pathToFileURL(path.join(appRoot, "dist/index.html")).href;
  function owner(event) {
    const window = getWindow(),
      sender = event.sender;
    if (
      !window ||
      window.isDestroyed() ||
      sender !== window.webContents ||
      event.senderFrame !== sender.mainFrame
    )
      throw Error("LOCAL_TRUSTED_WINDOW_REQUIRED");
    const url = new URL(event.senderFrame.url);
    url.hash = "";
    url.search = "";
    if (isDev ? url.origin !== "http://localhost:5173" : url.href !== expected)
      throw Error("LOCAL_TRUSTED_WINDOW_REQUIRED");
    if (!owners.has(sender.id)) {
      const life = { epoch: 0, choosing: false };
      owners.set(sender.id, life);
      const reset = () => {
        life.epoch++;
        browser.reset(sender.id);
      };
      sender.once("destroyed", reset);
      sender.on("render-process-gone", reset);
      sender.on("did-start-navigation", (_event, _url, _inPlace, main) => {
        if (main) reset();
      });
    }
    return { id: sender.id, life: owners.get(sender.id) };
  }
  ipcMain.handle("tandem-local-browser", async (event, operation, ...args) => {
    try {
      const { id, life } = owner(event),
        epoch = life.epoch;
      const check = () => {
        owner(event);
        if (life.epoch !== epoch) throw Error("LOCAL_CANCELLED");
      };
      let value;
      if (operation === "choose") {
        if (life.choosing) throw Error("LOCAL_BUSY");
        life.choosing = true;
        try {
          const selected = await dialog.showOpenDialog(getWindow(), {
            title: "选择本机工作目录",
            buttonLabel: "打开目录",
            properties: ["openDirectory"],
          });
          check();
          value = selected.canceled
            ? null
            : await browser.select(id, selected.filePaths[0], check);
        } finally {
          life.choosing = false;
        }
      } else if (operation === "list")
        value = await browser.list(id, args[0], args[1], args[2]);
      else if (operation === "upload")
        value = await browser.withSelection(
          id,
          args[0],
          args[1],
          (paths, guard) => uploads.selectForBrowser(event, paths, guard),
          (result) => uploads.sources.forget(id, result.id),
        );
      else if (operation === "download")
        value = await browser.withDirectory(
          id,
          args[0],
          args[1],
          (target, guard) => downloads.selectForBrowser(event, target, guard),
          async (result) => {
            await downloads.directories.cancel(id, result.id);
            downloads.directories.forget(id, result.id);
          },
        );
      else if (operation === "release") {
        browser.release(id, args[0]);
        value = null;
      } else throw Error("LOCAL_REQUEST_INVALID");
      check();
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: errorCode(error) };
    }
  });
  return {
    dispose: () => {
      for (const [id, life] of owners) {
        life.epoch++;
        browser.reset(id);
      }
    },
  };
}
module.exports = { registerLocalFileBrowserIpc };

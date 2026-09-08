const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { DownloadSink, errorCode } = require("./download-sink.cjs");
function registerDownloadIpc({
  ipcMain,
  dialog,
  shell,
  getWindow,
  appRoot,
  isDev,
}) {
  const sink = new DownloadSink(),
    lifetimes = new Map();
  const acceptedUrl = pathToFileURL(
    path.join(appRoot, "dist", "index.html"),
  ).href;
  function owner(event) {
    const window = getWindow(),
      sender = event.sender;
    if (
      !window ||
      window.isDestroyed() ||
      sender !== window.webContents ||
      event.senderFrame !== sender.mainFrame
    )
      throw Error("DOWNLOAD_TRUSTED_WINDOW_REQUIRED");
    const url = new URL(event.senderFrame.url);
    url.hash = "";
    url.search = "";
    if (
      isDev ? url.origin !== "http://localhost:5173" : url.href !== acceptedUrl
    )
      throw Error("DOWNLOAD_TRUSTED_WINDOW_REQUIRED");
    let life = lifetimes.get(sender.id);
    if (!life) {
      life = { epoch: 0, choosing: false };
      lifetimes.set(sender.id, life);
      const reset = () => {
        life.epoch++;
        void sink.reset(sender.id);
      };
      sender.once("destroyed", reset);
      sender.on("render-process-gone", reset);
      sender.on("did-start-navigation", (_e, _url, _inPlace, mainFrame) => {
        if (mainFrame) reset();
      });
    }
    return { id: sender.id, life };
  }
  ipcMain.handle("tandem-download", async (event, operation, ...args) => {
    try {
      const scoped = owner(event),
        id = scoped.id;
      let value;
      if (operation === "choose") {
        if (scoped.life.choosing) throw Error("DOWNLOAD_BUSY");
        scoped.life.choosing = true;
        const epoch = scoped.life.epoch;
        try {
          value = await sink.choose(id, args[0], async (name) => {
            const result = await dialog.showSaveDialog(getWindow(), {
              title: "选择下载目标",
              buttonLabel: "选择目标",
              defaultPath: name,
              properties: ["showOverwriteConfirmation"],
            });
            if (epoch !== scoped.life.epoch) throw Error("DOWNLOAD_CANCELLED");
            return result.canceled ? undefined : result.filePath;
          });
          if (epoch !== scoped.life.epoch) {
            await sink.reset(id);
            throw Error("DOWNLOAD_CANCELLED");
          }
        } finally {
          scoped.life.choosing = false;
        }
      } else if (operation === "reset") {
        scoped.life.epoch++;
        await sink.reset(id);
        value = null;
      } else {
        if (typeof args[0] !== "string") throw Error("DOWNLOAD_NOT_FOUND");
        if (operation === "start")
          value = await sink.start(id, args[0], args[1]);
        else if (operation === "append")
          value = await sink.append(id, args[0], args[1], args[2]);
        else if (["pause", "resume", "finish", "cancel"].includes(operation))
          value = await sink[operation](id, args[0]);
        else if (operation === "show") {
          const r = sink.owned(id, args[0]);
          if (r.view.state !== "completed") throw Error("DOWNLOAD_NOT_READY");
          shell.showItemInFolder(r.view.path);
          value = sink.view(r);
        } else throw Error("DOWNLOAD_REQUEST_INVALID");
      }
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: errorCode(error) };
    }
  });
  const timer = setInterval(() => void sink.prune(), 60000);
  timer.unref?.();
  return {
    sink,
    cancelActive: async () => {
      for (const owner of lifetimes.keys()) await sink.reset(owner);
    },
    dispose: async () => {
      clearInterval(timer);
      for (const owner of lifetimes.keys()) await sink.reset(owner);
    },
  };
}
module.exports = { registerDownloadIpc };

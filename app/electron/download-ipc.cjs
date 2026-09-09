const path = require("node:path");
const {
  DownloadDirectoryTargets,
} = require("./download-directory-targets.cjs");
const { pathToFileURL } = require("node:url");
const { DownloadSink, errorCode } = require("./download-sink.cjs");
function registerDownloadIpc({
  ipcMain,
  dialog,
  shell,
  getWindow,
  appRoot,
  isDev,
  recoveryOptions,
}) {
  const sink = new DownloadSink(),
    lifetimes = new Map();
  const directories = new DownloadDirectoryTargets(sink);
  const recovery = recoveryOptions
    ? require("./download-recovery-controller.cjs").createDownloadRecovery({
        sink,
        ...recoveryOptions,
      })
    : undefined;
  async function resetOwner(id) {
    try {
      await directories.reset(id);
    } finally {
      await sink.reset(id);
      await recovery?.reset(id);
    }
  }
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
        void resetOwner(sender.id);
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
      if (operation === "recovery") {
        if (!recovery) throw Error("DOWNLOAD_DESKTOP_REQUIRED");
        value = await recovery.handle(scoped, args[0], args[1], args[2]);
      } else if (operation === "choose") {
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
            await resetOwner(id);
            throw Error("DOWNLOAD_CANCELLED");
          }
        } finally {
          scoped.life.choosing = false;
        }
      } else if (operation === "reset") {
        scoped.life.epoch++;
        await resetOwner(id);
        value = null;
      } else {
        if (typeof args[0] !== "string") throw Error("DOWNLOAD_NOT_FOUND");
        if (operation === "start")
          value = await sink.start(id, args[0], args[1]);
        else if (operation === "append")
          value = await sink.append(id, args[0], args[1], args[2]);
        else if (
          ["pause", "resume", "finish", "cancel", "forget", "touch"].includes(
            operation,
          )
        ) {
          if (operation === "finish") await recovery?.beforeFinish(id, args[0]);
          try {
            value = await sink[operation](id, args[0]);
          } catch (e) {
            if (operation === "finish") recovery?.finishFailed(id, args[0]);
            throw e;
          }
          if (operation === "finish")
            await recovery?.afterFinish(id, args[0], value);
          if (operation === "cancel")
            await recovery?.afterCancel(id, args[0], value);
        } else if (operation === "show") {
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
  ipcMain.handle(
    "tandem-download-directory",
    async (event, operation, ...args) => {
      try {
        const { id, life } = owner(event);
        let value;
        if (operation === "choose") {
          if (life.choosing) throw Error("DOWNLOAD_BUSY");
          life.choosing = true;
          const epoch = life.epoch;
          try {
            value = await directories.choose(id, async () => {
              const result = await dialog.showOpenDialog(getWindow(), {
                title: "选择整批下载的目标文件夹",
                buttonLabel: "选择文件夹",
                properties: ["openDirectory", "createDirectory"],
              });
              if (life.epoch !== epoch) throw Error("DOWNLOAD_CANCELLED");
              return result.canceled ? undefined : result.filePaths[0];
            });
            if (life.epoch !== epoch) {
              await directories.reset(id);
              throw Error("DOWNLOAD_CANCELLED");
            }
          } finally {
            life.choosing = false;
          }
        } else {
          if (typeof args[0] !== "string") throw Error("DOWNLOAD_NOT_FOUND");
          if (operation === "preview")
            value = await directories.preview(id, args[0], args[1]);
          else if (operation === "confirm")
            value = directories.confirm(id, args[0], args[1], args[2]);
          else if (operation === "directories")
            value = await directories.directories(id, args[0]);
          else if (operation === "file")
            value = await directories.file(id, args[0], args[1], args[2]);
          else if (operation === "complete")
            value = directories.complete(id, args[0], args[1]);
          else if (operation === "show") {
            shell.showItemInFolder(directories.show(id, args[0], args[1]));
            value = null;
          } else if (operation === "cancel")
            value = await directories.cancel(id, args[0]);
          else if (operation === "forget")
            value = directories.forget(id, args[0]);
          else throw Error("DOWNLOAD_REQUEST_INVALID");
        }
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: errorCode(error) };
      }
    },
  );
  const timer = setInterval(() => void sink.prune(), 60000);
  timer.unref?.();
  return {
    sink,
    directories,
    cancelActive: async () => {
      for (const owner of lifetimes.keys()) await resetOwner(owner);
    },
    dispose: async () => {
      clearInterval(timer);
      for (const owner of lifetimes.keys()) await resetOwner(owner);
    },
  };
}
module.exports = { registerDownloadIpc };

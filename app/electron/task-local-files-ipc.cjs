const path = require("node:path"),
  { pathToFileURL } = require("node:url"),
  { randomUUID } = require("node:crypto");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function registerTaskLocalFilesIpc({
  ipcMain,
  dialog,
  getWindow,
  getBackend,
  appRoot,
  isDev,
}) {
  const owners = new Map(),
    watched = new Set(),
    choosing = new Set();
  let disposed = false;
  const expected = pathToFileURL(path.join(appRoot, "dist", "index.html")).href;
  function trusted(event) {
    const w = getWindow(),
      sender = event.sender;
    if (
      !w ||
      w.isDestroyed() ||
      sender !== w.webContents ||
      event.senderFrame !== sender.mainFrame
    )
      throw Error("FILE_LOCAL_TRUSTED_WINDOW_REQUIRED");
    const url = new URL(event.senderFrame.url);
    url.hash = "";
    url.search = "";
    if (isDev ? url.origin !== "http://localhost:5173" : url.href !== expected)
      throw Error("FILE_LOCAL_TRUSTED_WINDOW_REQUIRED");
    return sender;
  }
  function rpc(backend, method, windowToken, extra = {}) {
    if (!backend?.connected || disposed)
      return Promise.reject(Error("FILE_LOCAL_DESKTOP_REQUIRED"));
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        backend.removeListener("message", message);
        backend.removeListener("exit", exit);
        backend.removeListener("disconnect", exit);
        error ? reject(error) : resolve(value);
      };
      const message = (reply) => {
        if (
          reply?.type !== "tandem-local-files-response" ||
          reply.requestId !== requestId
        )
          return;
        if (reply.ok === true) finish(null, reply.value);
        else
          finish(
            Error(
              typeof reply.error === "string" &&
                /^[A-Z][A-Z0-9_]+$/.test(reply.error)
                ? reply.error
                : "FILE_LOCAL_REQUEST_FAILED",
            ),
          );
      };
      const exit = () => finish(Error("FILE_LOCAL_DESKTOP_REQUIRED"));
      const timer = setTimeout(
        () => finish(Error("FILE_LOCAL_REQUEST_TIMEOUT")),
        method === "fulfill" ? 300000 : 15000,
      );
      backend.on("message", message);
      backend.once("exit", exit);
      backend.once("disconnect", exit);
      try {
        backend.send(
          {
            type: "tandem-local-files-request",
            requestId,
            windowToken,
            method,
            ...extra,
          },
          (error) => {
            if (error) finish(Error("FILE_LOCAL_DESKTOP_REQUIRED"));
          },
        );
      } catch {
        exit();
      }
    });
  }
  function reset(senderId) {
    const r = owners.get(senderId);
    owners.delete(senderId);
    return r ? rpc(r.backend, "close", r.token) : Promise.resolve(null);
  }
  async function owner(event) {
    const sender = trusted(event),
      backend = getBackend();
    if (!backend?.connected) throw Error("FILE_LOCAL_DESKTOP_REQUIRED");
    let r = owners.get(sender.id);
    if (r && r.backend !== backend) {
      await reset(sender.id).catch(() => {});
      r = undefined;
    }
    if (!r) {
      r = { token: randomUUID(), backend, ready: null };
      owners.set(sender.id, r);
      r.ready = rpc(backend, "bind", r.token);
    }
    if (!watched.has(sender.id)) {
      watched.add(sender.id);
      sender.once("destroyed", () => {
        void reset(sender.id).catch(() => {});
      });
      sender.on("render-process-gone", () => reset(sender.id));
      sender.on("did-start-navigation", (_e, _url, _inPlace, main) => {
        if (main) void reset(sender.id).catch(() => {});
      });
    }
    try {
      await r.ready;
    } catch (e) {
      if (owners.get(sender.id) === r) owners.delete(sender.id);
      throw e;
    }
    if (owners.get(sender.id) !== r || getBackend() !== r.backend)
      throw Error("FILE_LOCAL_WINDOW_CLOSED");
    return { sender, r };
  }
  ipcMain.handle(
    "tandem-task-local-files",
    async (event, operation, ticketId) => {
      try {
        const sender = trusted(event);
        if (operation === "reset") {
          await reset(sender.id);
          return { ok: true, value: null };
        }
        if (operation !== "identity" && operation !== "choose")
          throw Error("FILE_LOCAL_REQUEST_INVALID");
        const { r } = await owner(event);
        if (operation === "identity")
          return { ok: true, value: { windowToken: r.token } };
        if (typeof ticketId !== "string" || !uuid.test(ticketId))
          throw Error("FILE_LOCAL_TICKET_INVALID");
        if (choosing.has(sender.id)) throw Error("FILE_LOCAL_GRANT_BUSY");
        choosing.add(sender.id);
        try {
          const choice = await rpc(r.backend, "claim", r.token, { ticketId });
          const current = () => {
            if (owners.get(sender.id) !== r || getBackend() !== r.backend)
              throw Error("FILE_LOCAL_WINDOW_CLOSED");
          };
          current();
          let paths;
          if (
            choice.kind === "directory" &&
            ["upload", "download"].includes(choice.direction)
          ) {
            const selected = await dialog.showOpenDialog(getWindow(), {
              title:
                choice.direction === "upload"
                  ? "选择本任务的上传目录"
                  : "选择本任务的下载目录",
              message: choice.title,
              buttonLabel: "授权所选目录",
              properties: ["openDirectory"],
            });
            paths = selected.canceled ? null : selected.filePaths;
          } else if (choice.kind && choice.kind !== "file")
            throw Error("FILE_LOCAL_REQUEST_INVALID");
          else if (choice.direction === "upload") {
            const selected = await dialog.showOpenDialog(getWindow(), {
              title: "选择本任务的上传来源",
              message: choice.title,
              buttonLabel: "授权所选文件",
              properties: ["openFile", "multiSelections"],
            });
            paths = selected.canceled ? null : selected.filePaths;
          } else if (choice.direction === "download") {
            const selected = await dialog.showSaveDialog(getWindow(), {
              title: "选择本任务的下载目标",
              message: choice.title,
              buttonLabel: "授权此目标",
              defaultPath: choice.suggestedName,
            });
            paths = selected.canceled ? null : [selected.filePath];
          } else throw Error("FILE_LOCAL_REQUEST_INVALID");
          current();
          if (!paths) {
            await rpc(r.backend, "cancel", r.token, { ticketId });
            return { ok: true, value: null };
          }
          const result = await rpc(r.backend, "fulfill", r.token, {
            ticketId,
            paths,
          });
          current();
          return { ok: true, value: result };
        } catch (error) {
          await rpc(r.backend, "cancel", r.token, { ticketId }).catch(() => {});
          if (error.message === "FILE_LOCAL_REQUEST_TIMEOUT")
            await reset(sender.id).catch(() => {});
          throw error;
        } finally {
          choosing.delete(sender.id);
        }
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
              ? error.message
              : "FILE_LOCAL_REQUEST_FAILED",
        };
      }
    },
  );
  return {
    dispose: () => {
      for (const id of owners.keys()) void reset(id).catch(() => {});
      disposed = true;
    },
  };
}
module.exports = { registerTaskLocalFilesIpc };

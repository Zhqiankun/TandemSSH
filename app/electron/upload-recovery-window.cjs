const { randomUUID } = require("node:crypto");
function createUploadRecoveryWindow(getBackend) {
  const windows = new Map();
  function rpc(scope, method) {
    if (!scope.backend?.connected)
      return Promise.reject(Error("UPLOAD_RECOVERY_DESKTOP_REQUIRED"));
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      let done = false;
      const finish = (e, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        scope.backend.removeListener("message", message);
        scope.backend.removeListener("exit", exit);
        scope.backend.removeListener("disconnect", exit);
        e ? reject(e) : resolve(value);
      };
      const message = (r) => {
        if (
          r?.type !== "tandem-upload-recovery-response" ||
          r.requestId !== requestId
        )
          return;
        r.ok
          ? finish(null, r.value)
          : finish(
              Error(
                typeof r.error === "string" && /^[A-Z][A-Z0-9_]+$/.test(r.error)
                  ? r.error
                  : "UPLOAD_RECOVERY_FAILED",
              ),
            );
      };
      const exit = () => finish(Error("UPLOAD_RECOVERY_DESKTOP_REQUIRED"));
      const timer = setTimeout(
        () => finish(Error("UPLOAD_RECOVERY_TIMEOUT")),
        30000,
      );
      scope.backend.on("message", message);
      scope.backend.once("exit", exit);
      scope.backend.once("disconnect", exit);
      try {
        scope.backend.send(
          {
            type: "tandem-upload-recovery-request",
            requestId,
            windowToken: scope.token,
            method,
          },
          (e) => {
            if (e) exit();
          },
        );
      } catch {
        exit();
      }
    });
  }
  async function reset(id) {
    const scope = windows.get(id);
    windows.delete(id);
    if (scope) await rpc(scope, "close").catch(() => {});
  }
  async function identity(id) {
    const backend = getBackend();
    if (!backend?.connected) throw Error("UPLOAD_RECOVERY_DESKTOP_REQUIRED");
    let scope = windows.get(id);
    if (scope && scope.backend !== backend) {
      await reset(id);
      scope = undefined;
    }
    if (!scope) {
      scope = { backend, token: randomUUID() };
      windows.set(id, scope);
      scope.ready = rpc(scope, "bind");
    }
    try {
      await scope.ready;
    } catch (e) {
      if (windows.get(id) === scope) windows.delete(id);
      throw e;
    }
    if (windows.get(id) !== scope || scope.backend !== getBackend())
      throw Error("UPLOAD_RECOVERY_WINDOW_CLOSED");
    return { windowToken: scope.token };
  }
  async function ownerFor(backend, token) {
    const entry = [...windows].find(
      ([, scope]) => scope.backend === backend && scope.token === token,
    );
    if (!entry || backend !== getBackend())
      throw Error("UPLOAD_RECOVERY_WINDOW_CLOSED");
    await entry[1].ready;
    if (windows.get(entry[0]) !== entry[1])
      throw Error("UPLOAD_RECOVERY_WINDOW_CLOSED");
    return entry[0];
  }
  return { identity, reset, ownerFor };
}
module.exports = { createUploadRecoveryWindow };

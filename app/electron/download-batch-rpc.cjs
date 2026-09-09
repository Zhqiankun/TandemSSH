const { randomUUID } = require("node:crypto");
function batchRequest(scope, method, ticketId, extra = {}) {
  const backend = scope.backend;
  if (!backend?.connected)
    return Promise.reject(Error("DOWNLOAD_DESKTOP_REQUIRED"));
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      backend.removeListener("message", message);
      backend.removeListener("disconnect", close);
      backend.removeListener("exit", close);
      if (error) reject(error);
      else resolve(value);
    };
    const message = (r) => {
      if (
        r?.type !== "tandem-download-batch-recovery-response" ||
        r.requestId !== requestId
      )
        return;
      if (r.ok) finish(null, r.value);
      else
        finish(
          Error(
            typeof r.error === "string" && /^[A-Z][A-Z0-9_]+$/.test(r.error)
              ? r.error
              : "DOWNLOAD_BATCH_FAILED",
          ),
        );
    };
    const close = () => finish(Error("DOWNLOAD_DESKTOP_REQUIRED")),
      timer = setTimeout(
        () => finish(Error("DOWNLOAD_BATCH_TIMEOUT")),
        ["restoreTree", "restoreSource"].includes(method) ? 300000 : 30000,
      );
    backend.on("message", message);
    backend.once("disconnect", close);
    backend.once("exit", close);
    try {
      backend.send(
        {
          type: "tandem-download-batch-recovery-request",
          requestId,
          windowToken: scope.token,
          ticketId,
          method,
          ...extra,
        },
        (e) => {
          if (e) close();
        },
      );
    } catch {
      close();
    }
  });
}
module.exports = { batchRequest };

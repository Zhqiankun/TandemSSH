const WebSocket = require("ws");
function probeC2SRelay({
  url,
  options,
  tunnel,
  targetHost,
  targetPort,
  signal,
  timeoutMs = 15000,
}) {
  if (signal.aborted)
    return Promise.resolve({
      success: false,
      error: signal.reason?.message || "C2S_CANCELLED",
    });
  return new Promise((resolve) => {
    const ws = new WebSocket(url, options);
    let settled = false;
    const finish = (result, terminate = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (terminate || ws.readyState === WebSocket.CONNECTING) ws.terminate();
      else ws.close();
      resolve(result);
    };
    const abort = () =>
      finish(
        { success: false, error: signal.reason?.message || "C2S_CANCELLED" },
        true,
      );
    const timer = setTimeout(
      () => finish({ success: false, error: "Tunnel test timed out" }, true),
      timeoutMs,
    );
    ws.on("error", (error) =>
      finish({ success: false, error: error.message }, true),
    );
    ws.on("close", () =>
      finish({ success: false, error: "Tunnel test connection closed" }),
    );
    ws.on("open", () => {
      if (settled || signal.aborted) return;
      ws.send(
        JSON.stringify({
          type: "test",
          tunnelConfig: tunnel,
          targetHost,
          targetPort,
        }),
      );
    });
    ws.on("message", (data, binary) => {
      if (settled || binary) return;
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "ready") finish({ success: true });
        else if (message.type === "error")
          finish({
            success: false,
            error: message.error || "Tunnel test failed",
          });
      } catch (error) {
        finish({ success: false, error: error.message }, true);
      }
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
module.exports = { probeC2SRelay };

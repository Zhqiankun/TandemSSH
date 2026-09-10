const path = require("node:path");
const { pathToFileURL } = require("node:url");
class C2sSession {
  constructor({ getWindow, appRoot, isDev, onChange }) {
    this.getWindow = getWindow;
    this.expected = pathToFileURL(path.join(appRoot, "dist/index.html")).href;
    this.isDev = isDev;
    this.onChange = onChange;
    this.token = null;
    this.epoch = 0;
    this.requests = new Map();
  }
  trusted(event) {
    const window = this.getWindow(),
      sender = event?.sender;
    if (
      !window ||
      window.isDestroyed() ||
      sender !== window.webContents ||
      event.senderFrame !== sender.mainFrame
    )
      throw Error("C2S_TRUSTED_WINDOW_REQUIRED");
    const url = new URL(event.senderFrame.url);
    url.hash = "";
    url.search = "";
    if (
      this.isDev
        ? url.origin !== "http://localhost:5173"
        : url.href !== this.expected
    )
      throw Error("C2S_TRUSTED_WINDOW_REQUIRED");
  }
  set(event, token) {
    this.trusted(event);
    if (
      token !== null &&
      (typeof token !== "string" || !token.length || token.length > 32768)
    )
      throw Error("C2S_AUTH_REQUIRED");
    if (token !== this.token) {
      this.clear();
      this.token = token;
    }
  }
  clear() {
    this.token = null;
    this.epoch++;
    for (const name of [...this.requests.keys()])
      this.cancel(name, "C2S_SESSION_CHANGED");
    this.onChange();
  }
  bind(tunnel) {
    if (!this.token) throw Error("C2S_AUTH_REQUIRED");
    const id = tunnel?.sourceIdentity;
    if (
      tunnel?.relayOrigin !== "local" ||
      !Number.isSafeInteger(tunnel.sourceHostId) ||
      tunnel.sourceHostId <= 0 ||
      !id ||
      typeof id.ip !== "string" ||
      typeof id.username !== "string" ||
      !Number.isSafeInteger(id.port) ||
      id.port < 1 ||
      id.port > 65535
    )
      throw Error("C2S_REVIEW_REQUIRED");
    return { ...tunnel, c2sSessionEpoch: this.epoch };
  }
  headers(tunnel) {
    if (!this.token) throw Error("C2S_AUTH_REQUIRED");
    if (tunnel?.c2sSessionEpoch !== this.epoch)
      throw Error("C2S_SESSION_CHANGED");
    return { Authorization: "Bearer " + this.token, "X-Electron-App": "true" };
  }
  request(tunnel, name) {
    this.headers(tunnel);
    const controller = new AbortController();
    let group = this.requests.get(name);
    if (!group) this.requests.set(name, (group = new Set()));
    group.add(controller);
    return {
      signal: controller.signal,
      release: () => {
        group.delete(controller);
        if (this.requests.get(name) === group && !group.size)
          this.requests.delete(name);
      },
    };
  }
  cancel(name, code = "C2S_CANCELLED", exceptSignal) {
    const group = this.requests.get(name);
    if (!group) return;
    for (const controller of [...group]) {
      if (controller.signal === exceptSignal) continue;
      group.delete(controller);
      controller.abort(Error(code));
    }
    if (this.requests.get(name) === group && !group.size)
      this.requests.delete(name);
  }
  get url() {
    return "ws://127.0.0.1:30003/ssh/tunnel/c2s/stream";
  }
}
module.exports = { C2sSession };

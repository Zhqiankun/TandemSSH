const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  updates: { action: (action) => ipcRenderer.invoke("tandem-update", action) },
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getPlatform: () => ipcRenderer.invoke("get-platform"),
  openNativeRdp: (options) => ipcRenderer.invoke("open-native-rdp", options),

  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  isElectron: true,
  isDev: process.env.NODE_ENV === "development",

  getSetting: (key) => ipcRenderer.invoke("get-setting", key),
  setSetting: (key, value) => ipcRenderer.invoke("set-setting", key, value),
  getC2STunnelConfig: () => ipcRenderer.invoke("get-c2s-tunnel-config"),
  saveC2STunnelConfig: (config) =>
    ipcRenderer.invoke("save-c2s-tunnel-config", config),
  checkLocalPortAvailable: (host, port) =>
    ipcRenderer.invoke("check-local-port-available", host, port),
  getC2STunnelPresetDefaultName: () =>
    ipcRenderer.invoke("get-c2s-tunnel-preset-default-name"),
  startC2STunnel: (tunnel, index) =>
    ipcRenderer.invoke("start-c2s-tunnel", tunnel, index),
  testC2STunnel: (tunnel, index) =>
    ipcRenderer.invoke("test-c2s-tunnel", tunnel, index),
  stopC2STunnel: (tunnelName) =>
    ipcRenderer.invoke("stop-c2s-tunnel", tunnelName),
  getC2STunnelStatuses: () => ipcRenderer.invoke("get-c2s-tunnel-statuses"),
  onC2STunnelStatuses: (callback) => {
    const listener = (_event, statuses) => callback(statuses);
    ipcRenderer.on("c2s-tunnel-statuses", listener);
    return () => ipcRenderer.removeListener("c2s-tunnel-statuses", listener);
  },
  startC2SAutoStartTunnels: () =>
    ipcRenderer.invoke("start-c2s-autostart-tunnels"),

  onRemoteSyncStatusChanged: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("remote-sync-status-changed", listener);
    return () =>
      ipcRenderer.removeListener("remote-sync-status-changed", listener);
  },
  onCloseActiveTab: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("close-active-tab", listener);
    return () => ipcRenderer.removeListener("close-active-tab", listener);
  },

  clearSessionCookies: () => ipcRenderer.invoke("clear-session-cookies"),
  getSessionCookie: (name, targetUrl) =>
    ipcRenderer.invoke("get-session-cookie", name, targetUrl),
  waitForSessionCookie: (name, targetUrl, previousValue, timeoutMs) =>
    ipcRenderer.invoke(
      "wait-session-cookie",
      name,
      targetUrl,
      previousValue,
      timeoutMs,
    ),

  oidcSystemBrowserAuth: (authUrl, callbackPort) =>
    ipcRenderer.invoke("oidc-system-browser-auth", authUrl, callbackPort),

  openExternalEditor: (fileData) =>
    ipcRenderer.invoke("open-external-editor", fileData),
  closeExternalEditor: (editId) =>
    ipcRenderer.invoke("close-external-editor", editId),
  onExternalEditorSaved: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("external-editor-saved", listener);
    return () => ipcRenderer.removeListener("external-editor-saved", listener);
  },

  downloadDirectories: {
    choose: () => ipcRenderer.invoke("tandem-download-directory", "choose"),
    preview: (id, entries) =>
      ipcRenderer.invoke("tandem-download-directory", "preview", id, entries),
    confirm: (id, revision, decisions) =>
      ipcRenderer.invoke(
        "tandem-download-directory",
        "confirm",
        id,
        revision,
        decisions,
      ),
    directories: (id) =>
      ipcRenderer.invoke("tandem-download-directory", "directories", id),
    file: (id, entry, spec) =>
      ipcRenderer.invoke("tandem-download-directory", "file", id, entry, spec),
    complete: (id, entry) =>
      ipcRenderer.invoke("tandem-download-directory", "complete", id, entry),
    show: (id, entry) =>
      ipcRenderer.invoke("tandem-download-directory", "show", id, entry),
    cancel: (id) =>
      ipcRenderer.invoke("tandem-download-directory", "cancel", id),
    forget: (id) =>
      ipcRenderer.invoke("tandem-download-directory", "forget", id),
  },
  uploadSources: {
    chooseDirectory: () =>
      ipcRenderer.invoke("tandem-upload-source", "choose-directory"),
    fromFiles: (files) => {
      if (!Array.isArray(files) || !files.length || files.length > 4096)
        throw Error("UPLOAD_SOURCE_INVALID");
      const paths = files.map((file) => webUtils.getPathForFile(file));
      if (paths.some((path) => !path)) throw Error("UPLOAD_SOURCE_INVALID");
      return ipcRenderer.invoke(
        "tandem-upload-source",
        "selected-files",
        paths,
      );
    },
    check: (id, entry) =>
      ipcRenderer.invoke("tandem-upload-source", "check", id, entry),
    chunk: (id, entry, offset, length) =>
      ipcRenderer.invoke(
        "tandem-upload-source",
        "chunk",
        id,
        entry,
        offset,
        length,
      ),
    forget: (id) => ipcRenderer.invoke("tandem-upload-source", "forget", id),
    reset: () => ipcRenderer.invoke("tandem-upload-source", "reset"),
  },
  downloads: {
    choose: (spec) => ipcRenderer.invoke("tandem-download", "choose", spec),
    start: (id, overwrite) =>
      ipcRenderer.invoke("tandem-download", "start", id, overwrite),
    append: (id, offset, bytes) =>
      ipcRenderer.invoke("tandem-download", "append", id, offset, bytes),
    action: (id, action) => ipcRenderer.invoke("tandem-download", action, id),
    reset: () => ipcRenderer.invoke("tandem-download", "reset"),
  },
  showSaveDialog: (options) => ipcRenderer.invoke("show-save-dialog", options),
  showOpenDialog: (options) => ipcRenderer.invoke("show-open-dialog", options),
  createTempFile: (fileData) =>
    ipcRenderer.invoke("create-temp-file", fileData),
  createTempFolder: (folderData) =>
    ipcRenderer.invoke("create-temp-folder", folderData),
  startDragToDesktop: (dragData) =>
    ipcRenderer.invoke("start-drag-to-desktop", dragData),
  cleanupTempFile: (tempId) => ipcRenderer.invoke("cleanup-temp-file", tempId),

  startLocalTerminal: (dimensions) =>
    ipcRenderer.invoke("local-terminal-start", dimensions),
  writeLocalTerminal: (sessionId, data) =>
    ipcRenderer.invoke("local-terminal-write", sessionId, data),
  readyLocalTerminal: (sessionId) =>
    ipcRenderer.invoke("local-terminal-ready", sessionId),
  resizeLocalTerminal: (sessionId, cols, rows) =>
    ipcRenderer.invoke("local-terminal-resize", sessionId, cols, rows),
  closeLocalTerminal: (sessionId) =>
    ipcRenderer.invoke("local-terminal-close", sessionId),
  onLocalTerminalData: (sessionId, callback) => {
    const channel = `local-terminal:data:${sessionId}`;
    const listener = (_event, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onLocalTerminalExit: (sessionId, callback) => {
    const channel = `local-terminal:exit:${sessionId}`;
    const listener = (_event, exitCode) => callback(exitCode);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  invoke: (channel, ...args) => {
    // Selection paths must originate in the isolated preload's File conversion or a native picker.
    if (
      typeof channel !== "string" ||
      channel.startsWith("tandem-upload-source")
    )
      throw Error("UPLOAD_SOURCE_CHANNEL_PRIVATE");
    return ipcRenderer.invoke(channel, ...args);
  },
});

contextBridge.exposeInMainWorld("electronClipboard", {
  writeText: (text) => ipcRenderer.invoke("clipboard-write-text", text),
  readText: () => ipcRenderer.invoke("clipboard-read-text"),
});

window.IS_ELECTRON = true;

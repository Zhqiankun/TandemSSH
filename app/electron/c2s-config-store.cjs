const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const MAX_BYTES = 8 * 1024 * 1024;
function importedTunnel(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("C2S_IMPORT_INVALID");
  const output = { scope: "c2s", autoStart: false };
  for (const key of [
    "bindHost",
    "targetHost",
    "endpointHost",
    "sourceHostName",
    "displayName",
  ]) {
    if (input[key] === undefined) continue;
    if (
      typeof input[key] !== "string" ||
      input[key].length > 2048 ||
      /[\u0000\r\n]/.test(input[key])
    )
      throw Error("C2S_IMPORT_INVALID");
    output[key] = input[key];
  }
  for (const [key, min, max] of [
    ["sourceHostId", 1, Number.MAX_SAFE_INTEGER],
    ["sourcePort", 1, 65535],
    ["endpointPort", 0, 65535],
    ["maxRetries", 0, 100],
    ["retryInterval", 0, 3600000],
  ]) {
    if (
      !Number.isSafeInteger(input[key]) ||
      input[key] < min ||
      input[key] > max
    )
      throw Error("C2S_IMPORT_INVALID");
    output[key] = input[key];
  }
  if (!["local", "remote", "dynamic"].includes(input.mode))
    throw Error("C2S_IMPORT_INVALID");
  output.mode = input.mode;
  output.tunnelType = input.mode === "remote" ? "remote" : "local";
  // Review must be renewed in this desktop: never carry relayOrigin, identity,
  // session epochs, diagnostics, credentials or automatic-start state.
  return output;
}
class C2sConfigStore {
  constructor(file) {
    this.file = file;
  }
  read() {
    let raw;
    try {
      if (fs.statSync(this.file).size > MAX_BYTES)
        throw Error("C2S_CONFIG_TOO_LARGE");
      raw = fs.readFileSync(this.file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      raw = undefined;
    }
    if (Buffer.byteLength(raw ?? "") > MAX_BYTES) throw Error("C2S_CONFIG_TOO_LARGE");
    let value;
    try {
      value = raw === undefined ? [] : JSON.parse(raw);
    } catch {
      throw Error("C2S_CONFIG_INVALID");
    }
    const state = Array.isArray(value)
      ? { config: value, receipts: {} }
      : value;
    if (
      !state ||
      (!Array.isArray(value) && state.version !== 1) ||
      !Array.isArray(state.config) ||
      !state.receipts ||
      typeof state.receipts !== "object" ||
      Array.isArray(state.receipts)
    )
      throw Error("C2S_CONFIG_INVALID");
    return {
      config: state.config,
      receipts: state.receipts,
      revision: digest(raw ?? ""),
    };
  }
  snapshot() {
    const { config, revision } = this.read();
    return { config, revision };
  }
  write(state) {
    const value = Object.keys(state.receipts).length
      ? { version: 1, config: state.config, receipts: state.receipts }
      : state.config;
    const raw = JSON.stringify(value, null, 2);
    if (Buffer.byteLength(raw) > MAX_BYTES) throw Error("C2S_CONFIG_TOO_LARGE");
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + "." + randomUUID() + ".tmp";
    let fd;
    try {
      fd = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(fd, raw);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, this.file);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  save(config, expectedRevision) {
    if (!Array.isArray(config)) throw Error("C2S_CONFIG_INVALID");
    const state = this.read();
    if (state.revision !== expectedRevision) throw Error("C2S_CONFIG_CHANGED");
    this.write({ ...state, config });
  }
  import(request) {
    if (
      !request ||
      !/^[a-f0-9-]{36}$/i.test(request.id) ||
      !/^[a-f0-9]{64}$/.test(request.revision) ||
      !Array.isArray(request.config) ||
      request.config.length > 128
    )
      throw Error("C2S_IMPORT_INVALID");
    const config = request.config.map(importedTunnel);
    const fingerprint = digest(JSON.stringify(config));
    const state = this.read();
    if (Object.hasOwn(state.receipts, request.id)) {
      const receipt = state.receipts[request.id];
      if (receipt.digest !== fingerprint)
        throw Error("C2S_IMPORT_CONFIRMATION_CHANGED");
      return { imported: receipt.imported, replayed: true };
    }
    if (state.revision !== request.revision) throw Error("C2S_CONFIG_CHANGED");
    if (
      Object.keys(state.receipts).length >= 1024 ||
      state.config.length + config.length > 2048
    )
      throw Error("C2S_IMPORT_LIMIT");
    this.write({
      config: [...state.config, ...config],
      receipts: {
        ...state.receipts,
        [request.id]: { digest: fingerprint, imported: config.length },
      },
    });
    return { imported: config.length, replayed: false };
  }
}
module.exports = { C2sConfigStore };

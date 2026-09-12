const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
function resolveLocalShell(platform, requestedShell, env = process.env) {
  if (
    requestedShell !== undefined &&
    !["default", "wsl", "cmd"].includes(requestedShell)
  )
    throw Error("LOCAL_TERMINAL_INVALID_SHELL");
  // Keep the configured native shell when a Windows-only hint reaches another platform.
  if (platform === "win32") {
    if (requestedShell === "cmd")
      return { file: env.ComSpec || "cmd.exe", args: ["/d"] };
    if (requestedShell === "wsl") {
      return { file: "wsl.exe", args: [] };
    }
    return {
      file: env.TERMIX_LOCAL_SHELL || "powershell.exe",
      args: ["-NoLogo"],
    };
  }

  return {
    file:
      env.TERMIX_LOCAL_SHELL ||
      env.SHELL ||
      (platform === "darwin" ? "/bin/zsh" : "/bin/bash"),
    args: ["-l"],
  };
}

function resolveLocalCwd(requested, home = os.homedir()) {
  const target = requested === undefined || requested === "" ? home : requested;
  if (
    typeof target !== "string" ||
    target.includes("\0") ||
    !path.isAbsolute(target)
  )
    throw Error("LOCAL_TERMINAL_INVALID_DIRECTORY");
  try {
    if (!fs.statSync(target).isDirectory()) throw Error("not a directory");
    return fs.realpathSync.native(target);
  } catch {
    throw Error("LOCAL_TERMINAL_DIRECTORY_UNAVAILABLE");
  }
}
module.exports = { resolveLocalShell, resolveLocalCwd };

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const unavailable = () => Error("LOCAL_ATTRIBUTES_UNAVAILABLE");
/** Owned by local file browsing. The helper only reads fixed Windows attribute bits. */
function createWindowsAttributesReader({
  platform = process.platform,
  spawnProcess = spawn,
  executable = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  ),
  timeoutMs = 15000,
} = {}) {
  let encodedScript;
  return async function readWindowsAttributes(root, names, signal) {
    if (platform !== "win32") return null;
    if (signal?.aborted) throw Error("LOCAL_CANCELLED");
    if (
      typeof root !== "string" ||
      !path.isAbsolute(root) ||
      !Array.isArray(names) ||
      names.length > 10000 ||
      names.some(
        (name) =>
          typeof name !== "string" ||
          !name ||
          name === "." ||
          name === ".." ||
          /[\\/:\x00-\x1f\x7f]/.test(name),
      )
    )
      throw Error("LOCAL_REQUEST_INVALID");
    if (!names.length) return [];
    const payload = JSON.stringify({ root, names });
    if (Buffer.byteLength(payload, "utf8") > 4 * 1024 * 1024)
      throw Error("LOCAL_LIMIT");
    try {
      encodedScript ??= Buffer.from(
        fs.readFileSync(
          path.join(__dirname, "windows-file-attributes.ps1"),
          "utf8",
        ),
        "utf16le",
      ).toString("base64");
    } catch {
      throw unavailable();
    }
    return new Promise((resolve, reject) => {
      let child,
        timer,
        finished = false,
        failure,
        outputBytes = 0,
        errorBytes = 0;
      const chunks = [];
      const finish = (error, result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        error ? reject(error) : resolve(result);
      };
      const stop = (error) => {
        if (finished || failure) return;
        failure = error;
        // This child runs only the fixed metadata script and spawns no descendants.
        child.kill();
      };
      const abort = () => stop(Error("LOCAL_CANCELLED"));
      try {
        child = spawnProcess(
          executable,
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            encodedScript,
          ],
          {
            windowsHide: true,
            shell: false,
            cwd: path.dirname(executable),
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
      } catch {
        finish(unavailable());
        return;
      }
      child.once("error", () => finish(failure || unavailable()));
      child.stdout.on("data", (bytes) => {
        if (failure || finished) return;
        outputBytes += bytes.length;
        if (outputBytes > 256 * 1024) {
          stop(unavailable());
          return;
        }
        chunks.push(bytes);
      });
      child.stderr.on("data", (bytes) => {
        errorBytes += bytes.length;
        if (errorBytes > 16 * 1024) stop(unavailable());
      });
      child.stdin.once("error", () => stop(unavailable()));
      child.once("close", (code) => {
        if (failure || code !== 0) {
          finish(failure || unavailable());
          return;
        }
        try {
          const values = JSON.parse(
            Buffer.concat(chunks)
              .toString("utf8")
              .replace(/^\uFEFF/, ""),
          );
          if (
            !Array.isArray(values) ||
            values.length !== names.length ||
            values.some(
              (value) =>
                value !== null &&
                (!Number.isInteger(value) || value < 0 || value > 0x7fffffff),
            )
          )
            throw unavailable();
          finish(null, values);
        } catch {
          finish(unavailable());
        }
      });
      timer = setTimeout(() => stop(unavailable()), timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      if (!failure) child.stdin.end(payload, "utf8");
    });
  };
}
module.exports = {
  createWindowsAttributesReader,
  readWindowsAttributes: createWindowsAttributesReader(),
};

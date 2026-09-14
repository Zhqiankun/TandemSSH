const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const FILES = [
  ["LICENSE", "LICENSE.electron.txt"],
  ["LICENSES.chromium.html", "LICENSES.chromium.html"],
];
async function checkedHash(root, relative) {
  const candidate = path.join(root, relative),
    actual = fs.realpathSync(candidate);
  const stat = fs.lstatSync(candidate);
  if (
    !actual.startsWith(root + path.sep) ||
    !stat.isFile() ||
    stat.isSymbolicLink()
  )
    throw Error("Runtime notice path invalid: " + relative);
  if (!stat.size || stat.size > 64 * 1024 * 1024)
    throw Error("Runtime notice size invalid: " + relative);
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(actual)) hash.update(chunk);
  return { bytes: stat.size, sha256: hash.digest("hex") };
}
async function verifyRuntimeNotices(packageRoot, options = {}) {
  const root = fs.realpathSync(packageRoot);
  const sourceRoot = fs.realpathSync(
    options.sourceRoot ||
      path.resolve(__dirname, "../node_modules/electron/dist"),
  );
  const runtimeVersion = options.runtimeVersion || process.versions.electron;
  const sourceVersion = fs
    .readFileSync(path.join(sourceRoot, "version"), "utf8")
    .trim();
  if (!runtimeVersion || runtimeVersion !== sourceVersion)
    throw Error("Runtime notice version mismatch");
  const notices = [];
  for (const [source, target] of FILES) {
    const expected = await checkedHash(sourceRoot, source),
      actual = await checkedHash(root, target);
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
      throw Error("Runtime notice differs from source: " + target);
    notices.push({ path: target, ...actual });
  }
  return { runtimeVersion, notices };
}
module.exports = { verifyRuntimeNotices };

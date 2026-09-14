const path = require("node:path");
const { createHash } = require("node:crypto");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** Validate the release's generated notices against its actual frontend chunks.
 * This detects omitted/stale artifacts; it is not a legal license review.
 */
function verifyFrontendNoticeContents(read) {
  const inventory = JSON.parse(
    read("dist/notices/frontend/inventory.json").toString("utf8"),
  );
  if (
    inventory.schemaVersion !== 1 ||
    inventory.scope !== "emitted-javascript-modules" ||
    !Array.isArray(inventory.packages) ||
    !inventory.packages.length ||
    inventory.packageCount !== inventory.packages.length ||
    !Array.isArray(inventory.chunks) ||
    !inventory.chunks.length ||
    inventory.chunks.length > 10000
  )
    throw Error("Frontend notice inventory incomplete");
  const notices = read("dist/notices/frontend/THIRD-PARTY-NOTICES.txt");
  if (
    !/^[a-f0-9]{64}$/.test(inventory.noticesSha256) ||
    sha(notices) !== inventory.noticesSha256
  )
    throw Error("Frontend notice text digest mismatch");
  const seen = new Set();
  let total = 0;
  for (const chunk of inventory.chunks) {
    if (
      typeof chunk.file !== "string" ||
      !/^[\w./-]+\.(?:mjs|js)$/.test(chunk.file) ||
      chunk.file.startsWith("/") ||
      chunk.file
        .split("/")
        .some((part) => !part || part === "." || part === "..") ||
      seen.has(chunk.file) ||
      !Number.isSafeInteger(chunk.bytes) ||
      chunk.bytes < 0 ||
      chunk.bytes > 64 * 1024 * 1024 ||
      (total += chunk.bytes) > 256 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(chunk.sha256)
    )
      throw Error("Frontend notice chunk entry invalid");
    seen.add(chunk.file);
    const bytes = read("dist/" + chunk.file);
    if (bytes.length !== chunk.bytes || sha(bytes) !== chunk.sha256)
      throw Error("Frontend notice chunk digest mismatch: " + chunk.file);
  }
  return {
    packages: inventory.packageCount,
    chunks: seen.size,
    reviewItems: inventory.packages.filter(
      (p) => Array.isArray(p.reviewItems) && p.reviewItems.length,
    ).length,
  };
}
async function verifyFrontendNotices(root) {
  const { extractFile } = await import("@electron/asar");
  const archive = path.join(root, "resources", "app.asar");
  return verifyFrontendNoticeContents((file) =>
    extractFile(archive, path.join(...file.split("/"))),
  );
}
module.exports = { verifyFrontendNoticeContents, verifyFrontendNotices };

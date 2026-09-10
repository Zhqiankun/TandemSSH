const semver = require("semver");
const { parseXml } = require("builder-util-runtime");
const { REPOSITORY, FEED_URL } = require("./update-source.cjs");
const ATOM_URL = "https://github.com/" + REPOSITORY + "/releases.atom";
const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-alpha\.(0|[1-9]\d*))?$/;
function validVersion(version) {
  return (
    typeof version === "string" &&
    VERSION_PATTERN.test(version) &&
    semver.valid(version) === version
  );
}
function selectPreviewFeed(xml, currentVersion) {
  if (!validVersion(currentVersion)) throw Error("UPDATE_METADATA_INVALID");
  const entries = parseXml(xml).getElements("entry");
  const prefix = "https://github.com/" + REPOSITORY + "/releases/tag/v";
  let latest;
  for (const entry of entries) {
    const link = entry.elementOrNull("link");
    const raw = link?.attributes?.href;
    if (typeof raw !== "string") continue;
    const url = new URL(raw, "https://github.com");
    if (!url.href.startsWith(prefix) || url.search || url.hash) continue;
    const version = url.href.slice(prefix.length);
    if (!validVersion(version)) continue;
    if (!semver.prerelease(currentVersion) && semver.prerelease(version))
      continue;
    if (!latest || semver.gt(version, latest)) latest = version;
  }
  if (!latest) throw Error("UPDATE_NOT_PUBLISHED");
  return (
    "https://github.com/" + REPOSITORY + "/releases/download/v" + latest + "/"
  );
}
async function discoverUpdateFeed(currentVersion, fetchFeed) {
  if (!semver.prerelease(currentVersion)) return FEED_URL;
  const request =
    fetchFeed ||
    ((url, options) =>
      require("electron")
        .session.fromPartition("electron-updater", { cache: false })
        .fetch(url, options));
  const response = await request(ATOM_URL, {
    headers: { Accept: "application/atom+xml" },
    credentials: "omit",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw Error(
      response.status === 404 ? "UPDATE_NOT_PUBLISHED" : "UPDATE_CHECK_FAILED",
    );
  }
  const reader = response.body.getReader(),
    chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 1024 * 1024) throw Error("UPDATE_METADATA_INVALID");
      chunks.push(Buffer.from(part.value));
    }
    return selectPreviewFeed(
      Buffer.concat(chunks).toString("utf8"),
      currentVersion,
    );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
module.exports = {
  ATOM_URL,
  validVersion,
  selectPreviewFeed,
  discoverUpdateFeed,
};

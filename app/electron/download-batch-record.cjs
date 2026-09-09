const path = require("node:path");
const { readDownloadCheckpoint } = require("./download-checkpoint.cjs");
const {
  readDownloadDirectoryCheckpoint,
} = require("./download-directory-checkpoint.cjs");
const { validName } = require("./download-directory-targets.cjs");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function validateDownloadBatch(row, user, id) {
  if (
    !row ||
    row.schemaVersion !== 1 ||
    row.userId !== user ||
    row.id !== id ||
    !uuid.test(id) ||
    !Number.isFinite(row.savedAt) ||
    !["preparing", "available", "claimed", "completed", "cancelled"].includes(
      row.state,
    )
  )
    throw Error("DOWNLOAD_BATCH_CORRUPT");
  const tree = row.source;
  if (
    !tree ||
    tree.schemaVersion !== 1 ||
    tree.userId !== user ||
    !uuid.test(tree.id) ||
    typeof tree.targetKey !== "string" ||
    !tree.targetKey ||
    typeof tree.peer !== "string" ||
    !tree.peer ||
    !Array.isArray(tree.entries) ||
    tree.entries.length > 4096
  )
    throw Error("DOWNLOAD_BATCH_CORRUPT");
  const target = readDownloadDirectoryCheckpoint(row.target),
    entries = new Map(target.entries.map((e) => [e.id, e])),
    remote = new Map(tree.entries.map((e) => [e.view?.id, e.view]));
  if (!Array.isArray(row.members) || row.members.length > 4096)
    throw Error("DOWNLOAD_BATCH_CORRUPT");
  const seen = new Set();
  for (const m of row.members) {
    const local = entries.get(m.entryId),
      source = remote.get(m.entryId);
    if (
      !local ||
      local.kind !== "file" ||
      !source ||
      seen.has(m.entryId) ||
      ![
        "pending",
        "paused",
        "committing",
        "unknown",
        "completed",
        "cancelled",
      ].includes(m.state)
    )
      throw Error("DOWNLOAD_BATCH_CORRUPT");
    seen.add(m.entryId);
    if (
      ["paused", "committing", "unknown"].includes(m.state) &&
      (!m.local || !m.source)
    )
      throw Error("DOWNLOAD_BATCH_CORRUPT");
    if (m.state === "completed" && local.result?.state !== "completed")
      throw Error("DOWNLOAD_BATCH_CORRUPT");
    if (m.local) {
      const cp = readDownloadCheckpoint(m.local),
        s = m.source;
      if (
        !s ||
        s.schemaVersion !== 1 ||
        s.userId !== user ||
        s.targetKey !== tree.targetKey ||
        s.peer !== tree.peer ||
        s.canonicalPath !== source.path ||
        s.stat?.size !== cp.spec.size ||
        s.sha256 !== cp.spec.sha256 ||
        JSON.stringify(s.hashes) !== JSON.stringify(cp.spec.hashes)
      )
        throw Error("DOWNLOAD_BATCH_SOURCE_MISMATCH");
      const names = [local.name];
      let parent = local.parentId ? entries.get(local.parentId) : undefined;
      while (parent) {
        names.unshift(parent.name);
        parent = parent.parentId ? entries.get(parent.parentId) : undefined;
      }
      if (
        !names.every(validName) ||
        path.resolve(target.path, ...names) !== cp.destination
      )
        throw Error("DOWNLOAD_BATCH_TARGET_MISMATCH");
    }
  }
  for (const e of target.entries)
    if (e.kind === "file" && !seen.has(e.id))
      throw Error("DOWNLOAD_BATCH_CORRUPT");
  if (["preparing", "claimed"].includes(row.state) && !row.claim)
    throw Error("DOWNLOAD_BATCH_CORRUPT");
  if (
    row.claim &&
    (!uuid.test(row.claim.id) ||
      typeof row.claim.boot !== "string" ||
      !Number.isSafeInteger(row.claim.pid) ||
      row.claim.pid <= 0)
  )
    throw Error("DOWNLOAD_BATCH_CORRUPT");
  return row;
}
module.exports = { validateDownloadBatch };

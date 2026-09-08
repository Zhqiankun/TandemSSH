const { createHash } = require("node:crypto");
const { CHUNK_BYTES } = require("./download-sink.cjs");
/** Native task sources share one versioned block reader and manifest builder. */
async function openTaskUploadSource(
  sources,
  input,
  authorize,
  onClose = () => {},
) {
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      onClose();
    }
  };
  const guard = () => {
    if (closed) throw Error("FILE_LOCAL_ACCESS_CLOSED");
    authorize();
  };
  const { owner, selectionId, entry } = input;
  try {
    guard();
    await sources.check(owner, selectionId, entry.id, guard);
    const hashes = [];
    for (let at = 0; at < entry.size; at += CHUNK_BYTES) {
      guard();
      const bytes = await sources.chunk(
        owner,
        selectionId,
        entry.id,
        at,
        Math.min(CHUNK_BYTES, entry.size - at),
        guard,
      );
      hashes.push(createHash("sha256").update(bytes).digest("hex"));
    }
    guard();
    return {
      manifest: {
        name: entry.name,
        size: entry.size,
        lastModified: entry.lastModified,
        hashes,
      },
      read: async (offset, length) => {
        guard();
        return Buffer.from(
          await sources.chunk(
            owner,
            selectionId,
            entry.id,
            offset,
            length,
            guard,
          ),
        );
      },
      verify: async () => {
        guard();
        await sources.check(owner, selectionId, entry.id, guard);
      },
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
module.exports = { openTaskUploadSource };

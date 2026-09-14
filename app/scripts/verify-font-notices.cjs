const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const sourceRoot = path.join(__dirname, "../packaging/font-notices");
const manifestBytes = fs.readFileSync(path.join(sourceRoot, "manifest.json"));
const manifest = JSON.parse(manifestBytes);
function verifyFontNoticeContents(readAsset, readNotice) {
  if (!readNotice("manifest.json").equals(manifestBytes))
    throw Error("Font manifest differs from source");
  for (const entry of manifest.notices) {
    const bytes = readNotice(entry.file);
    if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256)
      throw Error("Font notice digest mismatch: " + entry.file);
  }
  for (const font of manifest.fonts) {
    for (const prefix of ["dist/fonts/", "public/fonts/"]) {
      const bytes = readAsset(prefix + font.file);
      if (bytes.length !== font.bytes || sha(bytes) !== font.sha256)
        throw Error("Font asset digest mismatch: " + font.file);
    }
  }
  return {
    fonts: manifest.fonts.length,
    notices: manifest.notices.length,
    sourceVersion: manifest.source.version,
  };
}
async function verifyFontNotices(root) {
  const { extractFile } = await import("@electron/asar");
  const archive = path.join(root, "resources/app.asar");
  return verifyFontNoticeContents(
    (file) => extractFile(archive, path.join(...file.split("/"))),
    (file) => fs.readFileSync(path.join(root, "resources/notices/fonts", file)),
  );
}
module.exports = { verifyFontNoticeContents, verifyFontNotices };

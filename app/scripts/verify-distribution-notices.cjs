const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const NOTICE_FILES = [
  ["../LICENSE", "notices/LICENSE"],
  ["../NOTICE", "notices/NOTICE"],
  ["LICENSE", "notices/app/LICENSE"],
  ["UPSTREAM.md", "notices/app/UPSTREAM.md"],
];
function verifyDistributionNotices(
  packageRoot,
  appRoot = path.resolve(__dirname, ".."),
) {
  const root = fs.realpathSync(packageRoot);
  const verified = [];
  for (const [source, target] of NOTICE_FILES) {
    const expected = fs.readFileSync(path.resolve(appRoot, source));
    const file = path.join(root, "resources", target);
    if (!fs.existsSync(file))
      throw Error("Distribution notice missing: " + target);
    const actualPath = fs.realpathSync(file);
    if (
      !actualPath.startsWith(root + path.sep) ||
      !fs.statSync(actualPath).isFile()
    )
      throw Error("Distribution notice escaped package: " + target);
    const actual = fs.readFileSync(actualPath);
    if (!actual.equals(expected))
      throw Error("Distribution notice differs from source: " + target);
    verified.push({
      path: target,
      bytes: actual.length,
      sha256: crypto.createHash("sha256").update(actual).digest("hex"),
    });
  }
  return verified;
}
module.exports = { NOTICE_FILES, verifyDistributionNotices };
if (require.main === module) {
  try {
    console.log(
      JSON.stringify({
        distributionNotices: verifyDistributionNotices(
          path.resolve(process.argv[2]),
        ),
      }),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

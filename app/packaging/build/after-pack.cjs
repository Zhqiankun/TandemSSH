const fs = require("fs");
const path = require("path");

exports.default = async function afterPack(context) {
  const { targets, appOutDir } = context;
  if (context.electronPlatformName === "win32") {
    require("../../scripts/distribution-dependencies.cjs").writeDependencyNotices(
      appOutDir,
    );
  }

  const isDir = targets.some((t) => t.name === "dir");
  if (!isDir) return;

  const markerPath = path.join(appOutDir, ".portable");
  fs.writeFileSync(markerPath, "");
};

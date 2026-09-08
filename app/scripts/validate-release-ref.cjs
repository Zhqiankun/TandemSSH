const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
function validateReleaseRef(ref, version, resolve) {
  if (typeof ref !== "string") throw Error("A release tag is required");
  const tag = ref.replace(/^refs\/tags\//, "");
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
    throw Error("Stable vX.Y.Z tag required");
  if (tag !== "v" + version) throw Error("Tag and package version differ");
  if (resolve("HEAD") !== resolve("refs/tags/" + tag + "^{commit}"))
    throw Error("Checkout does not match the release tag commit");
  return tag;
}
module.exports = { validateReleaseRef };
if (require.main === module) {
  const root = path.resolve(__dirname, ".."),
    pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  try {
    const tag = validateReleaseRef(
      process.env.RELEASE_REF,
      pkg.version,
      (ref) =>
        execFileSync("git", ["rev-parse", "--verify", ref], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }).trim(),
    );
    if (process.env.GITHUB_OUTPUT)
      fs.appendFileSync(process.env.GITHUB_OUTPUT, "tag=" + tag + "\n");
    console.log("Verified release tag and checkout: " + tag);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

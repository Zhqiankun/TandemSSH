const fs = require("node:fs"),
  path = require("node:path");
function writeBackendPackage(appRoot = path.resolve(__dirname, "..")) {
  const app = JSON.parse(
    fs.readFileSync(path.join(appRoot, "package.json"), "utf8"),
  );
  const source = JSON.parse(
    fs.readFileSync(path.join(appRoot, "src/backend/package.json"), "utf8"),
  );
  if (
    app.name !== "tandemssh" ||
    typeof app.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(app.version) ||
    source.type !== "module"
  )
    throw Error("Invalid application version or backend module metadata");
  const result = {
    ...source,
    name: "tandemssh-backend",
    private: true,
    version: app.version,
  };
  const target = path.join(appRoot, "dist/backend/package.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(result, null, 2) + "\n");
  return result;
}
module.exports = { writeBackendPackage };
if (require.main === module) {
  try {
    console.log("Wrote backend metadata: " + writeBackendPackage().version);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

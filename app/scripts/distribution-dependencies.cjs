const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const RELATIVE_MODULES = "resources/app.asar.unpacked/node_modules";
const RELATIVE_OUTPUT = "resources/notices/dependencies";
const digest = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
function inside(root, file) {
  const resolved = fs.realpathSync(file);
  if (
    !resolved.startsWith(root + path.sep) ||
    fs.lstatSync(file).isSymbolicLink()
  )
    throw Error(
      "Dependency notice path escaped package: " + path.basename(file),
    );
  return resolved;
}
function collectDependencyNotices(packageRoot) {
  const root = fs.realpathSync(packageRoot),
    modules = inside(root, path.join(root, RELATIVE_MODULES));
  const packages = [],
    sections = [
      "TandemSSH — 随包 npm 依赖声明 / Packaged npm dependency notices",
      "This inventory records shipped package metadata and top-level notice texts. It is not a complete license review. Bundled frontend code, fonts, icons and native transitive libraries require separate review.",
    ];
  let totalBytes = 0;
  function read(file, limit) {
    inside(root, file);
    const stat = fs.statSync(file);
    if (
      !stat.isFile() ||
      stat.size > limit ||
      (totalBytes += stat.size) > 64 * 1024 * 1024
    )
      throw Error("Dependency notice size limit exceeded");
    return fs.readFileSync(file);
  }
  function visitPackage(folder) {
    inside(root, folder);
    if (packages.length >= 10000)
      throw Error("Dependency count limit exceeded");
    const relative = path.relative(modules, folder).split(path.sep).join("/"),
      issues = [];
    let metadata = {},
      packageSha256 = null;
    const metadataFile = path.join(folder, "package.json");
    if (fs.existsSync(metadataFile)) {
      const bytes = read(metadataFile, 1024 * 1024);
      packageSha256 = digest(bytes);
      metadata = JSON.parse(bytes.toString("utf8"));
    } else issues.push("PACKAGE_METADATA_MISSING");
    const declaration = metadata.license ?? metadata.licenses ?? null;
    if (!declaration) issues.push("LICENSE_DECLARATION_MISSING");
    const name = typeof metadata.name === "string" ? metadata.name : relative;
    const version =
      typeof metadata.version === "string" ? metadata.version : null;
    const texts = [];
    sections.push(
      "\n============================================================",
      name + "@" + (version ?? "unknown") + " [" + relative + "]",
      "Declared license: " + JSON.stringify(declaration),
    );
    for (const entry of fs
      .readdirSync(folder, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (
        !/^(licen[cs]e|notice|copying|copyright)(?:[._-].*)?$/i.test(entry.name)
      )
        continue;
      const file = path.join(folder, entry.name);
      inside(root, file);
      if (!entry.isFile()) continue;
      const bytes = read(file, 4 * 1024 * 1024);
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        issues.push("NON_UTF8_NOTICE:" + entry.name);
      }
      texts.push({
        path: entry.name,
        bytes: bytes.length,
        sha256: digest(bytes),
        included: text !== undefined,
      });
      if (text !== undefined)
        sections.push("\n--- " + entry.name + " ---\n" + text);
    }
    if (!texts.length) issues.push("NO_TOP_LEVEL_NOTICE");
    if (issues.length) sections.push("Review items: " + issues.join(", "));
    packages.push({
      path: relative,
      name,
      version,
      declaredLicense: declaration,
      packageSha256,
      notices: texts,
      reviewItems: issues,
    });
    const nested = path.join(folder, "node_modules");
    if (fs.existsSync(nested)) visitModules(nested);
  }
  function visitModules(folder) {
    inside(root, folder);
    for (const entry of fs
      .readdirSync(folder, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(folder, entry.name);
      inside(root, full);
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith("@")) {
        for (const child of fs
          .readdirSync(full, { withFileTypes: true })
          .sort((a, b) => a.name.localeCompare(b.name, "en"))) {
          const candidate = path.join(full, child.name);
          inside(root, candidate);
          if (child.isDirectory()) visitPackage(candidate);
        }
      } else visitPackage(full);
    }
  }
  visitModules(modules);
  return {
    inventory: {
      schemaVersion: 1,
      scope: "packaged-npm-dependencies",
      moduleRoot: RELATIVE_MODULES,
      packageCount: packages.length,
      packages,
    },
    text: sections.join("\n") + "\n",
  };
}
function writeDependencyNotices(packageRoot) {
  const result = collectDependencyNotices(packageRoot),
    root = fs.realpathSync(packageRoot);
  const notices = path.join(root, "resources/notices");
  if (fs.existsSync(notices)) inside(root, notices);
  const output = path.join(root, RELATIVE_OUTPUT);
  fs.mkdirSync(output, { recursive: true });
  inside(root, output);
  for (const [name, content] of [
    ["inventory.json", JSON.stringify(result.inventory, null, 2) + "\n"],
    ["THIRD-PARTY-NOTICES.txt", result.text],
  ]) {
    const target = path.join(output, name);
    if (fs.existsSync(target)) inside(root, target);
    fs.writeFileSync(target, content);
  }
  return {
    packages: result.inventory.packageCount,
    reviewItems: result.inventory.packages.filter((p) => p.reviewItems.length)
      .length,
  };
}
function verifyDependencyNotices(packageRoot) {
  const expected = collectDependencyNotices(packageRoot),
    root = fs.realpathSync(packageRoot);
  for (const [name, value] of [
    ["inventory.json", JSON.stringify(expected.inventory, null, 2) + "\n"],
    ["THIRD-PARTY-NOTICES.txt", expected.text],
  ]) {
    const target = path.join(root, RELATIVE_OUTPUT, name);
    inside(root, target);
    if (fs.readFileSync(target, "utf8") !== value)
      throw Error(
        "Dependency notice inventory differs from shipped files: " + name,
      );
  }
  return {
    packages: expected.inventory.packageCount,
    reviewItems: expected.inventory.packages.filter((p) => p.reviewItems.length)
      .length,
  };
}
module.exports = {
  collectDependencyNotices,
  writeDependencyNotices,
  verifyDependencyNotices,
};
if (require.main === module) {
  try {
    if (!["--write", "--verify"].includes(process.argv[2]) || !process.argv[3])
      throw Error(
        "Usage: distribution-dependencies.cjs --write|--verify PACKAGE_ROOT",
      );
    console.log(
      JSON.stringify(
        (process.argv[2] === "--verify"
          ? verifyDependencyNotices
          : writeDependencyNotices)(path.resolve(process.argv[3])),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

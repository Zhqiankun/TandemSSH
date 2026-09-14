import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Plugin } from "vite";

const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
/** Release infrastructure only: inventory package owners of emitted JS modules.
 * Assets, workers and native libraries have separate provenance requirements.
 */
export function collectFrontendNotices(
  projectRoot: string,
  moduleIds: string[],
) {
  const root = fs.realpathSync(projectRoot);
  const owners = new Map<string, Set<string>>();
  let totalBytes = 0;
  function read(file: string) {
    const real = fs.realpathSync(file);
    if (!real.startsWith(root + path.sep))
      throw Error("Frontend notice path escapes project");
    const stat = fs.statSync(real);
    if (
      !stat.isFile() ||
      stat.size > 4 * 1024 * 1024 ||
      (totalBytes += stat.size) > 64 * 1024 * 1024
    )
      throw Error("Frontend notice read limit exceeded");
    return fs.readFileSync(real);
  }
  const supplementalRoot = path.join(root, "packaging/dependency-notices");
  const manifestFile = path.join(supplementalRoot, "manifest.json");
  const supplements = new Map<
    string,
    { file: string; sha256: string; source: unknown }
  >();
  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(read(manifestFile).toString("utf8"));
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries))
      throw Error("Invalid supplemental notice manifest");
    for (const entry of manifest.entries) {
      if (
        typeof entry.name !== "string" ||
        typeof entry.version !== "string" ||
        typeof entry.file !== "string" ||
        path.basename(entry.file) !== entry.file ||
        !/^[a-f0-9]{64}$/.test(entry.sha256)
      )
        throw Error("Invalid supplemental notice entry");
      const key = entry.name + "@" + entry.version;
      if (supplements.has(key))
        throw Error("Duplicate supplemental notice version");
      supplements.set(key, entry);
    }
  }
  for (const id of [...new Set(moduleIds)].sort()) {
    if (id.startsWith("\0")) continue;
    const file = id.replace(/[?#].*$/, "");
    const normalized = file.replaceAll("\\", "/");
    const marker = normalized.lastIndexOf("/node_modules/");
    if (marker < 0) continue;
    const suffix = normalized.slice(marker + 14).split("/");
    const packageParts = suffix[0].startsWith("@") ? 2 : 1;
    if (suffix.length <= packageParts)
      throw Error("Invalid bundled dependency path");
    const folder = path.resolve(
      normalized.slice(0, marker + 14),
      ...suffix.slice(0, packageParts),
    );
    if (!folder.startsWith(root + path.sep))
      throw Error("Bundled dependency outside project");
    const modules = owners.get(folder) ?? new Set<string>();
    modules.add(path.relative(folder, file).replaceAll("\\", "/"));
    owners.set(folder, modules);
    if (owners.size > 10000)
      throw Error("Frontend dependency count limit exceeded");
  }
  const packages = [];
  const sections = [
    "TandemSSH — 前端依赖声明 / Frontend dependency notices",
    "Generated from modules in emitted JavaScript chunks. Missing declarations remain review items. Public assets, workers, fonts and native libraries require separate review.",
  ];
  for (const [folder, modules] of [...owners].sort(([a], [b]) =>
    a.localeCompare(b, "en"),
  )) {
    const metadataBytes = read(path.join(folder, "package.json"));
    const metadata = JSON.parse(metadataBytes.toString("utf8"));
    const issues: string[] = [];
    if (
      typeof metadata.name !== "string" ||
      typeof metadata.version !== "string"
    )
      throw Error("Bundled dependency metadata incomplete");
    const declaration = metadata.license ?? metadata.licenses ?? null;
    if (!declaration) issues.push("LICENSE_DECLARATION_MISSING");
    const notices = [];
    sections.push(
      "\n============================================================",
      metadata.name + "@" + metadata.version,
      "Declared license: " + JSON.stringify(declaration),
    );
    for (const entry of fs.readdirSync(folder).sort()) {
      if (!/^(licen[cs]e|notice|copying|copyright)(?:[._-].*)?$/i.test(entry))
        continue;
      const file = path.join(folder, entry);
      if (fs.lstatSync(file).isDirectory()) continue;
      const bytes = read(file);
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        issues.push("NOTICE_NOT_UTF8:" + entry);
        continue;
      }
      notices.push({ file: entry, bytes: bytes.length, sha256: sha(bytes) });
      sections.push("\n--- " + entry + " ---", text);
    }
    const supplement = supplements.get(metadata.name + "@" + metadata.version);
    if (supplement) {
      const bytes = read(path.join(supplementalRoot, supplement.file));
      if (sha(bytes) !== supplement.sha256)
        throw Error("Supplemental notice digest mismatch");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      notices.push({
        file: supplement.file,
        bytes: bytes.length,
        sha256: supplement.sha256,
        origin: "supplemental",
        provenance: supplement.source,
      });
      sections.push(
        "\n--- Supplemental notice: " + supplement.file + " ---",
        text,
      );
    }
    if (!notices.length) issues.push("NOTICE_TEXT_MISSING");
    packages.push({
      path: path.relative(root, folder).replaceAll("\\", "/"),
      name: metadata.name,
      version: metadata.version,
      declaration,
      packageSha256: sha(metadataBytes),
      modules: [...modules].sort(),
      notices,
      reviewItems: issues,
    });
  }
  return {
    inventory: {
      schemaVersion: 1,
      scope: "emitted-javascript-modules",
      packageCount: packages.length,
      packages,
    },
    text: sections.join("\n") + "\n",
  };
}

export function frontendNotices(): Plugin {
  let root: string;
  return {
    name: "tandem-frontend-notices",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      root = config.root;
    },
    generateBundle(_options, bundle) {
      const ids = Object.values(bundle).flatMap((entry) =>
        entry.type === "chunk" ? Object.keys(entry.modules) : [],
      );
      const result = collectFrontendNotices(root, ids);
      if (!result.inventory.packageCount)
        throw Error("No frontend dependencies inventoried");
      this.emitFile({
        type: "asset",
        fileName: "notices/frontend/inventory.json",
        source: JSON.stringify(result.inventory, null, 2) + "\n",
      });
      this.emitFile({
        type: "asset",
        fileName: "notices/frontend/THIRD-PARTY-NOTICES.txt",
        source: result.text,
      });
    },
    writeBundle: {
      order: "post",
      handler(options, bundle) {
        if (!options.dir)
          throw Error("Frontend notices require an output directory");
        const directory = path.resolve(options.dir);
        const manifest = path.join(
          directory,
          "notices/frontend/inventory.json",
        );
        const inventory = JSON.parse(fs.readFileSync(manifest, "utf8"));
        // Final chunk bytes may differ from generateBundle's intermediate code.
        inventory.noticesSha256 = sha(
          fs.readFileSync(
            path.join(directory, "notices/frontend/THIRD-PARTY-NOTICES.txt"),
          ),
        );
        inventory.chunks = Object.values(bundle)
          .filter(
            (entry) =>
              entry.type === "chunk" || /\.(?:mjs|js)$/.test(entry.fileName),
          )
          .map((entry) => {
            const bytes = fs.readFileSync(path.join(directory, entry.fileName));
            return {
              file: entry.fileName,
              bytes: bytes.length,
              sha256: sha(bytes),
            };
          })
          .sort((a, b) => a.file.localeCompare(b.file, "en"));
        fs.writeFileSync(manifest, JSON.stringify(inventory, null, 2) + "\n");
      },
    },
  };
}

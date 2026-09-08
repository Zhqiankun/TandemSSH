const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const yaml = require("js-yaml");
const {
  validateUpdateInfo,
  REPOSITORY,
} = require("../electron/update-service.cjs");
async function hash(file, algorithm, encoding) {
  const hash = createHash(algorithm);
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest(encoding);
}
(async () => {
  const root = path.resolve(__dirname, ".."),
    version = JSON.parse(
      await fs.readFile(path.join(root, "package.json"), "utf8"),
    ).version;
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw Error("Only stable version tags are published to the latest channel");
  const release = path.join(root, "release"),
    name = "TandemSSH-" + version + "-x64.exe",
    installer = path.join(release, name);
  const size = (await fs.stat(installer)).size,
    sha512 = await hash(installer, "sha512", "base64"),
    url =
      "https://github.com/" +
      REPOSITORY +
      "/releases/download/v" +
      version +
      "/" +
      name;
  const manifest = {
    version,
    files: [{ url, size, sha512 }],
    path: url,
    sha512,
    releaseDate: new Date().toISOString(),
  };
  validateUpdateInfo(manifest);
  await fs.writeFile(path.join(release, "latest.yml"), yaml.dump(manifest));
  const names = [
      name,
      name + ".blockmap",
      "TandemSSH-" + version + "-x64.zip",
      "latest.yml",
    ],
    lines = [];
  for (const name of names)
    lines.push(
      (await hash(path.join(release, name), "sha256", "hex")) + "  " + name,
    );
  await fs.writeFile(
    path.join(release, "SHA256SUMS.txt"),
    lines.join("\n") + "\n",
  );
  console.log("Verified installer and wrote version-pinned update manifest.");
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

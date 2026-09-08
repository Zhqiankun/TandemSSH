const fs = require("node:fs");
const path = require("node:path");
if (process.platform === "win32") {
  const appRoot = fs.realpathSync(path.resolve(__dirname, ".."));
  const ptyRoot = fs.realpathSync(
    path.dirname(require.resolve("node-pty/package.json")),
  );
  if (!ptyRoot.startsWith(appRoot + path.sep))
    throw Error("node-pty runtime must stay within the application");
  const build = path.join(ptyRoot, "build", "Release");
  if (fs.existsSync(path.join(build, "conpty.node"))) {
    if (fs.realpathSync(build) !== build)
      throw Error("Unexpected native build location");
    const versions = fs.readdirSync(
      path.join(ptyRoot, "third_party", "conpty"),
    );
    if (versions.length !== 1)
      throw Error("Expected one locked ConPTY runtime version");
    const source = fs.realpathSync(
      path.join(
        ptyRoot,
        "third_party",
        "conpty",
        versions[0],
        "win10-" + process.arch,
      ),
    );
    if (!source.startsWith(ptyRoot + path.sep))
      throw Error("Unexpected ConPTY runtime source");
    const target = path.join(build, "conpty");
    if (
      fs.existsSync(target) &&
      (fs.lstatSync(target).isSymbolicLink() ||
        !fs.lstatSync(target).isDirectory())
    )
      throw Error("Unexpected ConPTY runtime directory");
    fs.mkdirSync(target, { recursive: true });
    for (const name of ["conpty.dll", "OpenConsole.exe"]) {
      const from = path.join(source, name),
        to = path.join(target, name);
      if (
        !fs.lstatSync(from).isFile() ||
        (fs.existsSync(to) && !fs.lstatSync(to).isFile())
      )
        throw Error("Unexpected ConPTY runtime file");
      fs.copyFileSync(from, to);
    }
    console.log(
      "Copied the locked ConPTY runtime beside the rebuilt native addon",
    );
  } else {
    const prebuilt = path.join(
      ptyRoot,
      "prebuilds",
      "win32-" + process.arch,
      "conpty",
    );
    for (const name of ["conpty.dll", "OpenConsole.exe"])
      if (!fs.statSync(path.join(prebuilt, name)).isFile())
        throw Error("Bundled ConPTY runtime missing");
    console.log("Verified the bundled prebuilt ConPTY runtime");
  }
}

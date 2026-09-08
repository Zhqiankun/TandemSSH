const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
const ts = require(root + "/node_modules/typescript");
const en = JSON.parse(
  fs.readFileSync(root + "/src/ui/locales/en.json", "utf8"),
);
const missing = new Map();
function lookup(key) {
  return key.split(".").reduce((v, k) => v?.[k], en);
}
function scan(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (!["locales", "tests", "i18n"].includes(item.name)) scan(file);
      continue;
    }
    if (!/\.tsx?$/.test(file)) continue;
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source) === "t" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const key = node.arguments[0].text;
        if (!lookup(key) && !lookup(key + "_one") && !lookup(key + "_other")) {
          const options = node.arguments[1];
          let fallback;
          if (options && ts.isStringLiteral(options)) fallback = options.text;
          else if (options && ts.isObjectLiteralExpression(options)) {
            const prop = options.properties.find(
              (p) =>
                ts.isPropertyAssignment(p) &&
                p.name.getText(source) === "defaultValue",
            );
            if (prop && ts.isStringLiteral(prop.initializer))
              fallback = prop.initializer.text;
          }
          missing.set(key, {
            key,
            fallback,
            file: path.relative(root, file).replaceAll("\\", "/"),
          });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
scan(root + "/src/ui");
const out = [...missing.values()];
console.log(`Missing literal translation keys: ${out.length}`);
out.forEach((item) => console.error(`${item.file}: ${item.key}`));
if (out.length) process.exitCode = 1;

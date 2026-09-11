import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { readMcpVersion } from "../src/backend/mcp/version.js";
const require = createRequire(import.meta.url);
const { writeBackendPackage } = require("./write-backend-package.cjs");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      !root.startsWith(os.tmpdir() + path.sep) ||
      !path.basename(root).startsWith("tandem-version-")
    )
      throw Error("Fixture boundary");
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function fixture(version = "1.2.3-alpha.4") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-version-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "src/backend/mcp"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "tandemssh", version }),
  );
  fs.writeFileSync(
    path.join(root, "src/backend/package.json"),
    JSON.stringify({ type: "module" }),
  );
  fs.writeFileSync(
    path.join(root, "src/package.json"),
    JSON.stringify({ type: "module" }),
  );
  return root;
}
it("builds backend metadata from the application version and updates on the next build", () => {
  const root = fixture();
  writeBackendPackage(root);
  const moduleUrl = pathToFileURL(
    path.join(root, "dist/backend/backend/mcp/version.js"),
  ).href;
  expect(readMcpVersion(moduleUrl)).toBe("1.2.3-alpha.4");
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "tandemssh", version: "1.2.4" }),
  );
  expect(writeBackendPackage(root)).toMatchObject({
    type: "module",
    name: "tandemssh-backend",
    version: "1.2.4",
  });
  expect(readMcpVersion(moduleUrl)).toBe("1.2.4");
});
it("reads source version from its own project, not the test working directory", () => {
  const root = fixture("2.3.4");
  expect(
    readMcpVersion(
      pathToFileURL(path.join(root, "src/backend/mcp/version.js")).href,
    ),
  ).toBe("2.3.4");
});
it("refuses invalid or missing metadata instead of reporting an old version", () => {
  const root = fixture("invalid");
  expect(() => writeBackendPackage(root)).toThrow(
    "Invalid application version",
  );
  const moduleUrl = pathToFileURL(
    path.join(root, "dist/backend/backend/mcp/version.js"),
  ).href;
  expect(() => readMcpVersion(moduleUrl)).toThrow("MCP_VERSION_UNAVAILABLE");
  fs.mkdirSync(path.join(root, "dist/backend"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "dist/backend/package.json"),
    JSON.stringify({ name: "different-app", version: "1.0.0" }),
  );
  expect(() => readMcpVersion(moduleUrl)).toThrow("MCP_VERSION_UNAVAILABLE");
});

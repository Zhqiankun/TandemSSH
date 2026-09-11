import { readFileSync, statSync } from "node:fs";
/** Only fixed paths relative to this module; never trust cwd or a client-supplied version. */
export function readMcpVersion(moduleUrl: string = import.meta.url): string {
  const candidates = [
    [new URL("../../package.json", moduleUrl), "tandemssh-backend"],
    [new URL("../../../package.json", moduleUrl), "tandemssh"],
  ] as const;
  for (const [file, name] of candidates) {
    try {
      if (statSync(file).size > 128 * 1024)
        throw Error("MCP_VERSION_UNAVAILABLE");
      const value = JSON.parse(readFileSync(file, "utf8"));
      if (
        value.type === "module" &&
        value.name === undefined &&
        value.version === undefined
      )
        continue;
      if (
        value.name !== name ||
        typeof value.version !== "string" ||
        !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(value.version)
      )
        throw Error("MCP_VERSION_UNAVAILABLE");
      return value.version;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw Error("MCP_VERSION_UNAVAILABLE");
    }
  }
  throw Error("MCP_VERSION_UNAVAILABLE");
}

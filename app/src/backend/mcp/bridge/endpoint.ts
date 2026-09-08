import path from "node:path";
import os from "node:os";
import { z } from "zod";
export function localBridgeEndpoint(profileId: string): string {
  if (!z.string().uuid().safeParse(profileId).success)
    throw new Error("INVALID_PAIRING_REFERENCE");
  return process.platform === "win32"
    ? "\\\\.\\pipe\\tandemssh-" + profileId
    : path.join(
        os.tmpdir(),
        "tandemssh-" +
          (process.getuid?.() ?? "user") +
          "-" +
          profileId +
          ".sock",
      );
}

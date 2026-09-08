import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  LocalFileGrants,
  type LocalTaskIdentity,
  type NativeTaskLocalFiles,
} from "./local-file-grants.js";
import { journalFor } from "../collaboration/audit/production.js";
let resolveContext: (user: string, task: string) => LocalTaskIdentity = () => {
  throw Error("FILE_LOCAL_TASK_UNAVAILABLE");
};
let runtime: NativeTaskLocalFiles | undefined;
export function bindLocalTaskContext(resolve: typeof resolveContext) {
  resolveContext = resolve;
}
export function localFilesAvailable() {
  return (
    process.env.ELECTRON_EMBEDDED === "true" &&
    typeof process.send === "function" &&
    process.connected === true
  );
}
function native() {
  if (runtime) return runtime;
  if (!localFilesAvailable()) throw Error("FILE_LOCAL_DESKTOP_REQUIRED");
  if (!runtime) {
    const base = new URL(
      import.meta.url.endsWith(".ts") ? "../../../" : "../../../../",
      import.meta.url,
    );
    const require = createRequire(import.meta.url);
    const { TaskLocalFiles } = require(
      fileURLToPath(new URL("electron/task-local-files.cjs", base)),
    ) as { TaskLocalFiles: new () => NativeTaskLocalFiles };
    runtime = new TaskLocalFiles();
  }
  return runtime;
}
export const localFileGrants = new LocalFileGrants({
  available: localFilesAvailable,
  native,
  context: (user, task) => resolveContext(user, task),
  audit: (user, type, data) => journalFor(user).record(type, data),
});

import { randomUUID } from "node:crypto";

const quote = (value: string) => "'" + value.replace(/'/g, "'\"'\"'") + "'";

/** Remote copy owns its staging directory; final publication must not replace
 * or merge an existing destination. No fallback to an overwriting mv/cp. */
export function createCopyPlan(sourcePath: string, targetDir: string) {
  const id = randomUUID();
  const sourceName =
    sourcePath.split("/").filter(Boolean).pop() || "copied_item";
  const namePoints = Array.from(sourceName);
  while (Buffer.byteLength(namePoints.join(""), "utf8") > 213) namePoints.pop();
  const uniqueName = `${namePoints.join("")}_copy_${id}`;
  const targetPath = `${targetDir}/${uniqueName}`;
  const stagingPath = `${targetDir}/.tandem-copy-${id}`;
  const command = [
    `stage=${quote(stagingPath)}`,
    `target=${quote(targetPath)}`,
    '(umask 077; mkdir -- "$stage") || exit 1',
    // Install cleanup only after exclusive mkdir succeeds: never remove a
    // preexisting staging path owned by another operation.
    `trap 'rm -rf -- "$stage"' 0`,
    `cp -RP -- ${quote(sourcePath)} "$stage/item" || exit 1`,
    '[ ! -e "$target" ] && [ ! -L "$target" ] || exit 73',
    'mv -n -T -- "$stage/item" "$target" || exit 1',
    // Some mv implementations report success when -n skips a collision.
    '[ ! -e "$stage/item" ] && [ ! -L "$stage/item" ] || exit 73',
    'printf "%s\\n" COPY_SUCCESS',
  ].join("\n");
  return { uniqueName, targetPath, stagingPath, command };
}

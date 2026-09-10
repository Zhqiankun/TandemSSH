/** Unix mode display parsing owned by the file permission editor. */
export function parsePermissions(perms: string) {
  if (/^[0-7]{3,4}$/.test(perms)) {
    const mode = perms.padStart(4, "0");
    return {
      special: Number(mode[0]),
      owner: Number(mode[1]),
      group: Number(mode[2]),
      other: Number(mode[3]),
    };
  }
  const value = perms.length === 10 ? perms.slice(1) : perms;
  if (!/^[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/.test(value))
    return undefined;
  const bits = (part: string) =>
    (part[0] === "r" ? 4 : 0) +
    (part[1] === "w" ? 2 : 0) +
    (/[xst]/.test(part[2]) ? 1 : 0);
  return {
    special:
      (/[sS]/.test(value[2]) ? 4 : 0) +
      (/[sS]/.test(value[5]) ? 2 : 0) +
      (/[tT]/.test(value[8]) ? 1 : 0),
    owner: bits(value.slice(0, 3)),
    group: bits(value.slice(3, 6)),
    other: bits(value.slice(6, 9)),
  };
}

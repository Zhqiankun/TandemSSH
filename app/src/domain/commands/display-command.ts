/** Display a structured command with literal POSIX argument quoting.
 * This formatter does not authorize or execute commands. */
export function displayCommand(command: {
  program: string;
  args: readonly string[];
}): string {
  return [command.program, ...command.args]
    .map((part) =>
      /^[a-zA-Z0-9_./:@%+=,-]+$/.test(part)
        ? part
        : "'" + part.replaceAll("'", "'\\''") + "'",
    )
    .join(" ");
}

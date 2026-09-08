import type { TaskCommand } from "../../types/collaboration-task.js";
export class CommandPlanError extends Error {
  constructor(
    public readonly line: number,
    public readonly reason: "syntax" | "shell" | "empty" | "limit",
  ) {
    super(reason);
  }
}
/** A deliberately limited command-entry grammar. Shell constructs require an
 * explicit quoted interpreter command so the policy can identify and review it. */
export function parseCommandPlan(text: string): TaskCommand[] {
  const commands: TaskCommand[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const words: string[] = [];
    let word = "",
      active = false,
      quote: "'" | '"' | undefined;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (/[\x00-\x08\x0b-\x1f\x7f]/.test(c))
        throw new CommandPlanError(index + 1, "syntax");
      if (quote === "'") {
        if (c === "'") quote = undefined;
        else word += c;
        continue;
      }
      if (c === "\\") {
        if (i + 1 === line.length)
          throw new CommandPlanError(index + 1, "syntax");
        const next = line[++i];
        if (quote === '"' && !['"', "\\", "$", "\u0060"].includes(next))
          word += "\\";
        word += next;
        active = true;
        continue;
      }
      if (quote === '"') {
        if (c === '"') quote = undefined;
        else if (c === "$" || c === "\u0060")
          throw new CommandPlanError(index + 1, "shell");
        else word += c;
        continue;
      }
      if (c === "'" || c === '"') {
        quote = c;
        active = true;
        continue;
      }
      if (/\s/.test(c)) {
        if (active) {
          words.push(word);
          word = "";
          active = false;
        }
        continue;
      }
      if (/[;&|<>$\u0060()*?[\]{}~#]/.test(c))
        throw new CommandPlanError(index + 1, "shell");
      word += c;
      active = true;
    }
    if (quote) throw new CommandPlanError(index + 1, "syntax");
    if (active) words.push(word);
    if (!words[0]) throw new CommandPlanError(index + 1, "syntax");
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]))
      throw new CommandPlanError(index + 1, "shell");
    if (words.length > 257) throw new CommandPlanError(index + 1, "limit");
    commands.push({ program: words[0], args: words.slice(1) });
  }
  if (!commands.length) throw new CommandPlanError(1, "empty");
  if (commands.length > 100 || text.length > 100_000)
    throw new CommandPlanError(1, "limit");
  return commands;
}

import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  parseCommandPlan,
  CommandPlanError,
} from "../../../domain/commands/parse-plan.js";
import type {
  LegacyCommandRequest,
  LegacyCompilation,
  MacroStep,
} from "../../../types/legacy-commands.js";
import type { TaskCommand } from "../../../types/collaboration-task.js";
export interface LegacyHost {
  ip: string;
  username: string;
  port: number;
  name: string;
}
const text = z
  .string()
  .max(100000)
  .refine((s) => !s.includes("\0"));
const step: z.ZodType<MacroStep> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z
      .object({
        id: z.string().max(200),
        type: z.literal("send"),
        text,
        pressEnter: z.boolean(),
      })
      .strict(),
    z
      .object({
        id: z.string().max(200),
        type: z.literal("delay"),
        milliseconds: z.number().int().min(0).max(300000),
      })
      .strict(),
    z
      .object({
        id: z.string().max(200),
        type: z.literal("repeat"),
        count: z.number().int().min(1).max(100),
        steps: z.array(step).max(100),
      })
      .strict(),
    z
      .object({
        id: z.string().max(200),
        type: z.literal("wait"),
        pattern: z.string().max(1000),
        isRegex: z.boolean().optional(),
        flags: z.string().max(8).optional(),
        timeoutMs: z.number().int().min(100).max(300000),
        onTimeout: z.enum(["stop", "continue"]),
      })
      .strict(),
    z
      .object({
        id: z.string().max(200),
        type: z.literal("if"),
        pattern: z.string().max(1000),
        isRegex: z.boolean().optional(),
        flags: z.string().max(8).optional(),
        then: z.array(step).max(100),
        else: z.array(step).max(100),
      })
      .strict(),
  ]),
);
export const legacySourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("snippet"),
      title: z.string().min(1).max(200),
      content: text,
      inputs: z
        .record(
          z.string().regex(/^INPUT_\d+$/),
          z
            .string()
            .max(32768)
            .refine((v) => !v.includes("\0")),
        )
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("macro"),
      title: z.string().min(1).max(200),
      steps: z.array(step).max(100),
    })
    .strict(),
]);
function depthCheck(value: unknown, depth = 0, counter = { count: 0 }) {
  if (depth > 12 || ++counter.count > 3000)
    throw Error("LEGACY_PLAN_TOO_LARGE");
  if (Array.isArray(value))
    value.forEach((v) => depthCheck(v, depth + 1, counter));
  else if (value && typeof value === "object")
    Object.values(value).forEach((v) => depthCheck(v, depth + 1, counter));
}
function commands(text: string): TaskCommand[] {
  try {
    return parseCommandPlan(text);
  } catch (error) {
    if (error instanceof CommandPlanError)
      throw Error(
        error.reason === "shell"
          ? "LEGACY_SHELL_MIGRATION_REQUIRED"
          : "LEGACY_COMMAND_INVALID",
      );
    throw error;
  }
}
export function parseLegacySource(input: unknown): LegacyCommandRequest {
  if (!input || typeof input !== "object")
    throw Error("LEGACY_COMMAND_INVALID");
  depthCheck(input);
  if (JSON.stringify(input).length > 256000)
    throw Error("LEGACY_PLAN_TOO_LARGE");
  return legacySourceSchema.parse(input);
}
export function compileLegacy(
  input: LegacyCommandRequest,
  host: LegacyHost,
): LegacyCompilation {
  const source = parseLegacySource(input),
    result: TaskCommand[] = [],
    notes: string[] = [];
  const add = (list: TaskCommand[]) => {
    if (result.length + list.length > 100) throw Error("LEGACY_PLAN_TOO_LARGE");
    result.push(...list);
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > 256000)
      throw Error("LEGACY_PLAN_TOO_LARGE");
  };
  if (source.kind === "snippet") {
    const bindings = new Map<string, string>(),
      nonce = "tandem_value_" + randomUUID().replaceAll("-", "");
    let index = 0;
    const template = source.content.replace(
      /\$\{(HOST|USER|PORT|NAME|INPUT_\d+)(?::[^}$]*)?\}|\$(HOST|USER|PORT|NAME|INPUT_\d+)(?![A-Za-z0-9_])/g,
      (_all, braced, plain) => {
        const name = braced ?? plain;
        const values: Record<string, string> = {
          HOST: host.ip,
          USER: host.username,
          PORT: String(host.port),
          NAME: host.name,
          ...source.inputs,
        };
        const value = values[name];
        if (value === undefined) throw Error("LEGACY_INPUT_REQUIRED");
        const marker = nonce + "_" + index++ + "_end";
        bindings.set(marker, value);
        return marker;
      },
    );
    const parsed = commands(template);
    for (const command of parsed) {
      if (
        [...bindings.keys()].some((marker) => command.program.includes(marker))
      )
        throw Error("LEGACY_DYNAMIC_PROGRAM");
      add([
        {
          ...command,
          args: command.args.map((arg) => {
            let value = arg;
            for (const [marker, replacement] of bindings) {
              value = value.replaceAll(marker, () => replacement);
              if (Buffer.byteLength(value, "utf8") > 48000)
                throw Error("LEGACY_PLAN_TOO_LARGE");
            }
            return value;
          }),
        },
      ]);
    }
  } else {
    let pending = "";
    const walk = (steps: MacroStep[], depth = 0) => {
      if (depth > 4) throw Error("LEGACY_PLAN_TOO_LARGE");
      for (const item of steps) {
        if (item.type === "send") {
          pending += item.text;
          if (pending.length > 100000) throw Error("LEGACY_PLAN_TOO_LARGE");
          if (item.pressEnter) {
            add(commands(pending));
            pending = "";
          }
        } else if (item.type === "repeat") {
          if (pending) throw Error("LEGACY_INTERACTIVE_MIGRATION_REQUIRED");
          for (let i = 0; i < item.count; i++) walk(item.steps, depth + 1);
        } else if (item.type === "delay") {
          if (pending) throw Error("LEGACY_INTERACTIVE_MIGRATION_REQUIRED");
          if (item.milliseconds)
            add([
              {
                program: "sleep",
                args: [String(item.milliseconds / 1000)],
                name: "宏中的等待",
                timeoutMs: item.milliseconds + 5000,
              },
            ]);
        } else throw Error("LEGACY_INTERACTIVE_MIGRATION_REQUIRED");
      }
    };
    walk(source.steps);
    if (pending) throw Error("LEGACY_INTERACTIVE_MIGRATION_REQUIRED");
    notes.push("MACRO_WAITS_FOR_COMMAND_RESULTS");
  }
  if (!result.length) throw Error("LEGACY_COMMAND_INVALID");
  return { commands: result, notes };
}

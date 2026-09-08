import { z } from "zod";
import type {
  WorkflowDefinition,
  WorkflowParameter,
  WorkflowValue,
  WorkflowArgument,
} from "../../../types/workflow.js";
import type { TaskCommand } from "../../../types/collaboration-task.js";
import { validateCommandAction } from "../policies/command-policy.js";
const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/);
const text = z
  .string()
  .max(32768)
  .refine((value) => !value.includes("\0"));
const directory = text.refine(
  (value) => value.startsWith("/") && !/[\x00-\x1f\x7f]/.test(value),
);
const reference = z.object({ param: identifier }).strict();
const value = z.union([text, reference]);
const argument = z.union([
  text,
  reference,
  z
    .object({
      param: identifier,
      whenTrue: z.array(text).max(32),
      whenFalse: z.array(text).max(32),
    })
    .strict(),
]);
const common = {
  required: z.boolean().optional(),
  description: z.string().max(2000).optional(),
};
const parameter = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("string"),
      ...common,
      default: text.optional(),
      minLength: z.number().int().min(0).max(32768).optional(),
      maxLength: z.number().int().min(1).max(32768).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("remote-directory"),
      ...common,
      default: directory.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("integer"),
      ...common,
      default: z.number().int().safe().optional(),
      min: z.number().int().safe().optional(),
      max: z.number().int().safe().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("boolean"),
      ...common,
      default: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("enum"),
      ...common,
      default: text.optional(),
      values: z.array(text).min(1).max(100),
    })
    .strict(),
  z.object({ type: z.literal("secret-ref"), ...common }).strict(),
]);
const timeout = z.number().int().min(1000).max(600000);
export const workflowSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifier,
    name: z.string().min(1).max(120),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
    description: z.string().max(8000).optional(),
    category: z.string().max(120).optional(),
    shellState: z.enum(["explicit-cwd", "stateful-shell"]).optional(),
    parameters: z.record(identifier, parameter),
    defaults: z
      .object({
        cwd: value.optional(),
        timeoutMs: timeout.optional(),
        onFailure: z.enum(["stop", "continue"]).optional(),
        retry: z
          .object({ maxAttempts: z.literal(1) })
          .strict()
          .optional(),
        env: z
          .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,79}$/), value)
          .optional(),
      })
      .strict(),
    steps: z
      .array(
        z
          .object({
            id: identifier,
            name: z.string().min(1).max(120),
            cwd: value.optional(),
            timeoutMs: timeout.optional(),
            onFailure: z.enum(["stop", "continue"]).optional(),
            action: z.discriminatedUnion("type", [
              z
                .object({
                  type: z.literal("command"),
                  program: z
                    .string()
                    .min(1)
                    .max(1024)
                    .refine((value) => !/[\x00-\x1f\x7f]/.test(value)),
                  args: z.array(argument).max(256),
                })
                .strict(),
              z
                .object({
                  type: z.literal("script"),
                  shell: z.enum(["sh", "bash"]),
                  source: text,
                  args: z.array(argument).max(256).optional(),
                })
                .strict(),
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export class WorkflowError extends Error {
  constructor(
    code: string,
    public readonly field?: string,
  ) {
    super(code);
  }
}
function fail(code: string, field?: string): never {
  throw new WorkflowError(code, field);
}
export function parseWorkflow(input: unknown): WorkflowDefinition {
  if (JSON.stringify(input ?? null).length > 256000) fail("WORKFLOW_TOO_LARGE");
  const result = workflowSchema.safeParse(input);
  if (!result.success)
    fail("INVALID_WORKFLOW", result.error.issues[0]?.path.join("."));
  const definition = result.data as WorkflowDefinition;
  if (Object.keys(definition.parameters).length > 64)
    fail("WORKFLOW_PARAMETER_LIMIT");
  if (
    definition.steps.length +
      (Object.keys(definition.defaults.env ?? {}).length ? 1 : 0) >
    100
  )
    fail("WORKFLOW_STEP_LIMIT");
  const ids = new Set<string>();
  for (const step of definition.steps) {
    if (ids.has(step.id)) fail("DUPLICATE_STEP_ID", step.id);
    ids.add(step.id);
  }
  function check(atom: WorkflowArgument, field: string, directoryOnly = false) {
    if (typeof atom === "string") {
      if (directoryOnly && !directory.safeParse(atom).success)
        fail("INVALID_DIRECTORY", field);
      return;
    }
    const spec = definition.parameters[atom.param];
    if (!Object.hasOwn(definition.parameters, atom.param))
      fail("UNKNOWN_PARAMETER", atom.param);
    if (directoryOnly && spec.type !== "remote-directory")
      fail("DIRECTORY_PARAMETER_REQUIRED", field);
    if ("whenTrue" in atom && spec.type !== "boolean")
      fail("BOOLEAN_PARAMETER_REQUIRED", field);
    if (spec.type === "boolean" && !("whenTrue" in atom))
      fail("BOOLEAN_MAPPING_REQUIRED", field);
  }
  if (definition.defaults.cwd)
    check(definition.defaults.cwd, "defaults.cwd", true);
  for (const [name, atom] of Object.entries(definition.defaults.env ?? {}))
    check(atom, "env." + name);
  for (const step of definition.steps) {
    if (step.cwd) check(step.cwd, step.id + ".cwd", true);
    for (const atom of step.action.args ?? []) check(atom, step.id + ".args");
  }
  for (const [name, spec] of Object.entries(definition.parameters)) {
    if (
      spec.type === "integer" &&
      spec.min !== undefined &&
      spec.max !== undefined &&
      spec.min > spec.max
    )
      fail("INVALID_PARAMETER_RANGE", name);
    if (
      spec.type === "string" &&
      spec.minLength !== undefined &&
      spec.maxLength !== undefined &&
      spec.minLength > spec.maxLength
    )
      fail("INVALID_PARAMETER_RANGE", name);
    if ("default" in spec && spec.default !== undefined)
      parameterValue(spec, spec.default, name);
  }
  return structuredClone(definition);
}
function parameterValue(
  spec: WorkflowParameter,
  value: unknown,
  name: string,
): string | number | boolean | undefined {
  if (value === undefined) {
    if ("default" in spec && spec.default !== undefined) value = spec.default;
    else if (spec.required) fail("PARAMETER_REQUIRED", name);
    else return undefined;
  }
  if (spec.type === "secret-ref") fail("SECRET_TRANSPORT_UNSUPPORTED", name);
  if (spec.type === "integer") {
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      (spec.min !== undefined && value < spec.min) ||
      (spec.max !== undefined && value > spec.max)
    )
      fail("INVALID_PARAMETER", name);
    return value;
  }
  if (spec.type === "boolean") {
    if (typeof value !== "boolean") fail("INVALID_PARAMETER", name);
    return value;
  }
  if (typeof value !== "string" || value.includes("\0") || value.length > 32768)
    fail("INVALID_PARAMETER", name);
  if (
    spec.type === "string" &&
    ((spec.minLength !== undefined && value.length < spec.minLength) ||
      (spec.maxLength !== undefined && value.length > spec.maxLength))
  )
    fail("INVALID_PARAMETER", name);
  if (spec.type === "enum" && !spec.values.includes(value))
    fail("INVALID_PARAMETER", name);
  if (spec.type === "remote-directory" && !directory.safeParse(value).success)
    fail("INVALID_DIRECTORY", name);
  return value;
}
export function compileWorkflow(
  raw: unknown,
  input: Record<string, unknown>,
): {
  definition: WorkflowDefinition;
  commands: TaskCommand[];
  warnings: string[];
} {
  const definition = parseWorkflow(raw);
  for (const key of Object.keys(input))
    if (!Object.hasOwn(definition.parameters, key))
      fail("UNKNOWN_PARAMETER", key);
  const parameters = Object.fromEntries(
    Object.entries(definition.parameters).map(([name, spec]) => [
      name,
      parameterValue(
        spec,
        Object.hasOwn(input, name) ? input[name] : undefined,
        name,
      ),
    ]),
  );
  const resolve = (atom: WorkflowValue): string => {
    if (typeof atom === "string") return atom;
    const result = parameters[atom.param];
    if (result === undefined) fail("PARAMETER_REQUIRED", atom.param);
    if (typeof result === "boolean")
      fail("BOOLEAN_MAPPING_REQUIRED", atom.param);
    return String(result);
  };
  const args = (atoms: WorkflowArgument[]) =>
    atoms.flatMap((atom) =>
      typeof atom !== "string" && "whenTrue" in atom
        ? parameters[atom.param] === undefined
          ? fail("PARAMETER_REQUIRED", atom.param)
          : parameters[atom.param]
            ? atom.whenTrue
            : atom.whenFalse
        : [resolve(atom)],
    );
  const commands: TaskCommand[] = [];
  const warnings: string[] = [];
  const defaults = definition.defaults;
  if (Object.keys(defaults.env ?? {}).length) {
    commands.push({
      stepId: "workflow-environment",
      name: "设置流程环境变量",
      program: "export",
      args: Object.entries(defaults.env ?? {}).map(
        ([key, atom]) => key + "=" + resolve(atom),
      ),
      cwd: defaults.cwd ? resolve(defaults.cwd) : undefined,
      timeoutMs: defaults.timeoutMs ?? 120000,
      onFailure: "stop",
    });
    warnings.push("PERSISTENT_ENVIRONMENT");
  }
  for (const [index, step] of definition.steps.entries()) {
    const cwd = step.cwd
      ? resolve(step.cwd)
      : definition.shellState === "stateful-shell" && index > 0
        ? undefined
        : defaults.cwd
          ? resolve(defaults.cwd)
          : undefined;
    if (cwd && !directory.safeParse(cwd).success)
      fail("INVALID_DIRECTORY", step.id);
    const command: TaskCommand = {
      stepId: step.id,
      name: step.name,
      program:
        step.action.type === "command"
          ? step.action.program
          : step.action.shell,
      args:
        step.action.type === "command"
          ? args(step.action.args)
          : [
              "-c",
              step.action.source,
              "tandem-workflow",
              ...args(step.action.args ?? []),
            ],
      cwd,
      timeoutMs: step.timeoutMs ?? defaults.timeoutMs ?? 120000,
      onFailure: step.onFailure ?? defaults.onFailure ?? "stop",
    };
    validateCommandAction({
      type: "terminal.command",
      program: command.program,
      args: command.args,
      cwd: command.cwd ?? "/",
      timeoutMs: command.timeoutMs,
    });
    commands.push(command);
    if (command.onFailure === "continue")
      warnings.push("CONTINUE_AFTER_FAILURE:" + step.id);
    if (step.action.type === "script")
      warnings.push("SCRIPT_REVIEW_REQUIRED:" + step.id);
  }
  if (Buffer.byteLength(JSON.stringify(commands), "utf8") > 512000)
    fail("WORKFLOW_EXPANSION_TOO_LARGE");
  return { definition, commands, warnings };
}

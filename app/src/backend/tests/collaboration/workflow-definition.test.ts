import { describe, it, expect } from "vitest";
import {
  compileWorkflow,
  parseWorkflow,
} from "../../collaboration/workflows/definition.js";
import type { WorkflowDefinition } from "../../../types/workflow.js";
export function definition(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    id: "deploy",
    name: "部署",
    version: "1.0.0",
    parameters: {
      folder: { type: "remote-directory", required: true },
      message: { type: "string", default: "hello" },
      enabled: { type: "boolean", default: false },
    },
    defaults: { cwd: { param: "folder" } },
    steps: [
      {
        id: "echo",
        name: "预览",
        action: {
          type: "command",
          program: "printf",
          args: [
            "%s",
            { param: "message" },
            { param: "enabled", whenTrue: ["--verbose"], whenFalse: [] },
          ],
        },
      },
    ],
  };
}
describe("saved workflow parameter compilation", () => {
  it("keeps shell punctuation and newlines inside one argv value", () => {
    const input = definition(),
      payload = "你好; $(touch never)\nsecond line\n";
    const result = compileWorkflow(input, {
      folder: "/srv/应用",
      message: payload,
      enabled: true,
    });
    expect(result.commands[0]).toMatchObject({
      program: "printf",
      args: ["%s", payload, "--verbose"],
      cwd: "/srv/应用",
      timeoutMs: 120000,
      onFailure: "stop",
    });
    expect(input.steps[0].action.args?.[1]).toEqual({ param: "message" });
  });
  it("validates types, rejects undeclared inputs, and preserves boolean false", () => {
    expect(
      compileWorkflow(definition(), { folder: "/srv" }).commands[0].args,
    ).toEqual(["%s", "hello"]);
    expect(() =>
      compileWorkflow(definition(), { folder: "/srv", enabled: "true" }),
    ).toThrow("INVALID_PARAMETER");
    expect(() => compileWorkflow(definition(), { folder: "relative" })).toThrow(
      "INVALID_DIRECTORY",
    );
    expect(() =>
      compileWorkflow(definition(), { folder: "/srv", extra: "x" }),
    ).toThrow("UNKNOWN_PARAMETER");
  });
  it("validates integer bounds and enum defaults before saving", () => {
    const input = definition();
    input.parameters.count = { type: "integer", min: 1, max: 10, default: 20 };
    expect(() => parseWorkflow(input)).toThrow("INVALID_PARAMETER");
    input.parameters.count = { type: "enum", values: ["a"], default: "b" };
    expect(() => parseWorkflow(input)).toThrow("INVALID_PARAMETER");
  });
  it("requires explicit boolean argument mapping", () => {
    const input = definition();
    input.steps[0].action.args = [{ param: "enabled" }];
    expect(() => parseWorkflow(input)).toThrow("BOOLEAN_MAPPING_REQUIRED");
  });
  it("does not accept prototype properties as declared parameter values", () => {
    const input = definition();
    input.parameters.constructor = { type: "string", default: "literal" };
    input.steps[0].action.args = [{ param: "constructor" }];
    expect(compileWorkflow(input, { folder: "/srv" }).commands[0].args).toEqual(
      ["literal"],
    );
    input.steps[0].action.args = [{ param: "toString" }];
    expect(() => parseWorkflow(input)).toThrow("UNKNOWN_PARAMETER");
  });
  it("refuses plaintext defaults and unsupported secret-reference transport", () => {
    const input = definition();
    input.parameters.secret = { type: "secret-ref" };
    input.steps[0].action.args = [{ param: "secret" }];
    expect(() =>
      compileWorkflow(input, { folder: "/srv", secret: "credential-id" }),
    ).toThrow("SECRET_TRANSPORT_UNSUPPORTED");
    expect(() =>
      parseWorkflow({
        ...input,
        parameters: { secret: { type: "secret-ref", default: "plaintext" } },
      }),
    ).toThrow("INVALID_WORKFLOW");
  });
  it("treats multiline scripts as exact source arguments and emits a review warning", () => {
    const input = definition();
    input.steps[0].action = {
      type: "script",
      shell: "bash",
      source: 'printf "%s" "$1"\nprintf done',
      args: [{ param: "message" }],
    };
    const result = compileWorkflow(input, { folder: "/srv" });
    expect(result.commands[0].args).toEqual([
      "-c",
      input.steps[0].action.source,
      "tandem-workflow",
      "hello",
    ]);
    expect(result.warnings).toContain("SCRIPT_REVIEW_REQUIRED:echo");
  });
  it("distinguishes explicit cwd from shell state inheritance", () => {
    const input = definition();
    input.steps.push({
      id: "next",
      name: "下一步",
      action: { type: "command", program: "pwd", args: [] },
    });
    expect(
      compileWorkflow(input, { folder: "/srv" }).commands.map((c) => c.cwd),
    ).toEqual(["/srv", "/srv"]);
    input.shellState = "stateful-shell";
    expect(
      compileWorkflow(input, { folder: "/srv" }).commands.map((c) => c.cwd),
    ).toEqual(["/srv", undefined]);
  });
  it("includes environment setup within the step limit and rejects automatic retries", () => {
    const input = definition();
    input.defaults.env = { MODE: "release" };
    input.steps = Array.from({ length: 100 }, (_, i) => ({
      ...input.steps[0],
      id: "step" + i,
    }));
    expect(() => parseWorkflow(input)).toThrow("WORKFLOW_STEP_LIMIT");
    input.steps = input.steps.slice(0, 1);
    expect(compileWorkflow(input, { folder: "/srv" }).commands[0].program).toBe(
      "export",
    );
    expect(() =>
      parseWorkflow({ ...input, defaults: { retry: { maxAttempts: 2 } } }),
    ).toThrow("INVALID_WORKFLOW");
  });
  it("rejects import extras, duplicate steps, and unknown references without executing anything", () => {
    const input = definition();
    expect(() => parseWorkflow({ ...input, run: true })).toThrow(
      "INVALID_WORKFLOW",
    );
    input.steps.push(input.steps[0]);
    expect(() => parseWorkflow(input)).toThrow("DUPLICATE_STEP_ID");
  });
});

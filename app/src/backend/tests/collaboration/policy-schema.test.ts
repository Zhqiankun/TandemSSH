import { describe, it, expect } from "vitest";
import {
  validatePolicySets,
  validatePolicySnapshot,
} from "../../collaboration/policies/schema.js";
import { evaluateCommandPolicy } from "../../collaboration/policies/command-policy.js";
import type { CommandPolicySet } from "../../../types/collaboration-operations.js";
const sets: CommandPolicySet[] = [
  {
    id: "global",
    scope: { type: "global" },
    strictAllowlist: false,
    rules: [
      {
        id: "no-rm",
        effect: "deny",
        match: { kind: "program", program: "rm" },
        reason: "禁止删除",
      },
    ],
  },
];
describe("policy configuration contract", () => {
  it("rejects malformed saved policies rather than falling back to allow", () => {
    expect(() =>
      validatePolicySnapshot({ revision: 1, sets: "invalid" }),
    ).toThrow();
    expect(() => validatePolicySets([{ ...sets[0], extra: true }])).toThrow(
      "INVALID_POLICY",
    );
    expect(() => validatePolicySets([sets[0], sets[0]])).toThrow(
      "DUPLICATE_POLICY_ID",
    );
    expect(() =>
      validatePolicySets([
        { ...sets[0], rules: [sets[0].rules[0], sets[0].rules[0]] },
      ]),
    ).toThrow("DUPLICATE_RULE_ID");
  });
  it("freezes a draft and applies deny before a more specific allow during trial", () => {
    const draft = validatePolicySets([
      ...sets,
      {
        id: "host",
        scope: { type: "host", id: "1" },
        strictAllowlist: false,
        rules: [
          {
            id: "allow-rm",
            effect: "allow",
            match: { kind: "program", program: "rm" },
            reason: "test",
          },
        ],
      },
    ]);
    const decision = evaluateCommandPolicy(
      { revision: 1, sets: draft },
      { hostId: "1", groupIds: [] },
      {
        type: "terminal.command",
        program: "/bin/rm",
        args: ["file"],
        cwd: "/srv",
      },
    );
    expect(decision.outcome).toBe("deny");
    draft[0].rules = [];
    expect(sets[0].rules).toHaveLength(1);
  });
});

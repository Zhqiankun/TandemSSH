import { expect, it } from "vitest";
import { evaluateCommandPolicy } from "../../collaboration/policies/command-policy.js";
import { evaluateFilePathPolicy } from "../../collaboration/policies/file-policy.js";
import { validatePolicySets } from "../../collaboration/policies/schema.js";
import type { CommandPolicySet } from "../../../types/collaboration-operations.js";

const sets: CommandPolicySet[] = [
  {
    id: "all",
    scope: { type: "global" },
    strictAllowlist: false,
    rules: [
      {
        id: "command-read",
        effect: "allow",
        match: { kind: "program", program: "pwd" },
        reason: "global allow",
      },
    ],
    fileRules: [
      {
        id: "read",
        effect: "allow",
        match: { kind: "directory", path: "/srv", access: ["read", "write"] },
        reason: "global allow",
      },
    ],
  },
  {
    id: "group",
    scope: { type: "group", id: "prod" },
    strictAllowlist: false,
    rules: [
      {
        id: "command-review",
        effect: "confirm",
        match: { kind: "program", program: "pwd" },
        reason: "group review",
      },
    ],
    fileRules: [
      {
        id: "review",
        effect: "confirm",
        match: { kind: "directory", path: "/srv", access: ["read", "write"] },
        reason: "group review",
      },
    ],
  },
  {
    id: "host",
    scope: { type: "host", id: "1" },
    strictAllowlist: false,
    rules: [
      {
        id: "command-block",
        effect: "deny",
        match: { kind: "program", program: "pwd" },
        reason: "host deny",
      },
    ],
    fileRules: [
      {
        id: "block",
        effect: "deny",
        match: { kind: "directory", path: "/srv", access: ["read", "write"] },
        reason: "host deny",
      },
    ],
  },
  {
    id: "task",
    scope: { type: "task", id: "restricted" },
    strictAllowlist: true,
    strictFileAllowlist: true,
    rules: [],
    fileRules: [],
  },
];
function permutations<T>(items: T[]): T[][] {
  return items.length
    ? items.flatMap((item, i) =>
        permutations(items.filter((_, n) => n !== i)).map((rest) => [
          item,
          ...rest,
        ]),
      )
    : [[]];
}
const cases = [
  { hostId: "2", groupIds: [], taskId: "other", outcome: "allow" },
  { hostId: "2", groupIds: ["prod"], taskId: "other", outcome: "confirm" },
  { hostId: "1", groupIds: [], taskId: "other", outcome: "deny" },
  { hostId: "1", groupIds: ["prod"], taskId: "other", outcome: "deny" },
  { hostId: "2", groupIds: [], taskId: "restricted", outcome: "deny" },
  { hostId: "2", groupIds: ["prod"], taskId: "restricted", outcome: "deny" },
  { hostId: "1", groupIds: [], taskId: "restricted", outcome: "deny" },
  { hostId: "1", groupIds: ["prod"], taskId: "restricted", outcome: "deny" },
];
it.each(cases)(
  "keeps command/file scope precedence for $hostId / $groupIds / $taskId",
  (target) => {
    for (const ordered of permutations(sets)) {
      const snapshot = { revision: 9, sets: validatePolicySets(ordered) };
      const decisions = [
        evaluateCommandPolicy(snapshot, target, {
          type: "terminal.command",
          program: "pwd",
          args: [],
          cwd: "/srv",
        }),
        evaluateFilePathPolicy(snapshot, target, ["/srv/config"], "read"),
        evaluateFilePathPolicy(snapshot, target, ["/srv/config"], "write"),
      ];
      for (const [index, result] of decisions.entries()) {
        const prefix = index === 0 ? "command-" : "";
        expect(result.outcome).toBe(target.outcome);
        expect(result.revision).toBe(9);
        expect(result.matchedRules).toContain("all/" + prefix + "read");
        expect(result.matchedRules.includes("host/" + prefix + "block")).toBe(
          target.hostId === "1",
        );
        expect(result.matchedRules.includes("group/" + prefix + "review")).toBe(
          target.groupIds.includes("prod"),
        );
        if (target.taskId === "restricted")
          expect(result.reasons.some((r) => r.endsWith(":task"))).toBe(true);
      }
    }
  },
);
it.each(["read", "write"] as const)(
  "requires every requested and resolved path in every applicable %s allowlist",
  (access) => {
    const global = sets[0],
      host: CommandPolicySet = {
        id: "narrow",
        scope: { type: "host", id: "2" },
        strictAllowlist: false,
        rules: [],
        fileRules: [
          {
            id: "app",
            effect: "allow",
            match: {
              kind: "directory",
              path: "/srv/app",
              access: ["read", "write"],
            },
            reason: "application only",
          },
        ],
      };
    for (const ordered of [
      [global, host],
      [host, global],
    ]) {
      const snapshot = { revision: 3, sets: validatePolicySets(ordered) },
        target = { hostId: "2", groupIds: [], taskId: "other" };
      expect(
        evaluateFilePathPolicy(
          snapshot,
          target,
          ["/srv/app/config", "/srv/app/real"],
          access,
        ).outcome,
      ).toBe("allow");
      for (const paths of [
        ["/srv/app/config", "/srv/elsewhere"],
        ["/srv/app/config", "/etc/shadow"],
        ["/srv/app/../elsewhere"],
        ["/srv/application/file"],
      ])
        expect(
          evaluateFilePathPolicy(snapshot, target, paths, access).outcome,
        ).toBe("deny");
    }
  },
);

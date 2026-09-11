import assert from "node:assert/strict";
import type { CommandPolicySnapshot } from "../../types/collaboration-operations.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = fs.realpathSync(process.env.DATA_DIR ?? "");
if (
  path.dirname(directory) !== fs.realpathSync(os.tmpdir()) ||
  !/^tandem-policy-db-[A-Za-z0-9]+$/.test(path.basename(directory)) ||
  process.env.DATABASE_DIALECT !== "sqlite" ||
  process.env.DB_FILE_ENCRYPTION !== "true"
)
  throw Error("Policy database fixture boundary");
const mode = process.argv[2];
if (mode !== "write" && mode !== "read") throw Error("Fixture mode");
const { initializeDatabase, getSqlite, databasePaths } =
  await import("../database/db/index.js");
const { createCurrentSettingsRepository, getCurrentSettingValue } =
  await import("../database/repositories/factory.js");
const { validatePolicySnapshot } =
  await import("../collaboration/policies/schema.js");
const { evaluateCommandPolicy } =
  await import("../collaboration/policies/command-policy.js");
await initializeDatabase();
const snapshot: CommandPolicySnapshot = {
  revision: 7,
  sets: [
    {
      id: "global",
      scope: { type: "global" as const },
      strictAllowlist: false,
      rules: [
        {
          id: "deny-df",
          effect: "deny" as const,
          match: { kind: "program" as const, program: "df" },
          reason: "固定规则持久化验证",
        },
      ],
    },
  ],
};
for (const scope of [
  { type: "group", id: "prod" },
  { type: "host", id: "fixture" },
  { type: "task", id: "task" },
] as const) {
  snapshot.sets.push({
    id: scope.type,
    scope,
    strictAllowlist: true,
    rules: [
      {
        id: "allow-df",
        effect: "allow",
        match: { kind: "program-args", program: "df", args: ["-h"] },
        reason: "范围规则持久化",
      },
    ],
  });
}
if (mode === "write")
  await createCurrentSettingsRepository().set(
    "tandem-policy:fixture-owner",
    JSON.stringify(snapshot),
  );
const restored = validatePolicySnapshot(
  JSON.parse(getCurrentSettingValue("tandem-policy:fixture-owner") ?? "null"),
);
assert.deepEqual(restored, snapshot, "Stored snapshot mismatch");
const decision = evaluateCommandPolicy(
  restored,
  { hostId: "fixture", groupIds: ["prod"], taskId: "task" },
  { type: "terminal.command", program: "df", args: ["-h"], cwd: "/" },
);
if (
  decision.outcome !== "deny" ||
  getCurrentSettingValue("tandem-policy:other-owner") !== null
)
  throw Error("Restored policy behavior mismatch");
if (
  !fs.existsSync(databasePaths.encrypted) ||
  fs.existsSync(path.join(directory, "db.sqlite"))
)
  throw Error("Expected encrypted storage only");
console.log(
  "POLICY_STORAGE_RESULT " +
    JSON.stringify({
      mode,
      revision: restored.revision,
      outcome: decision.outcome,
      encryptedBytes: fs.statSync(databasePaths.encrypted).size,
    }),
);
getSqlite().close();
// Deliberately no shutdown-save: the acknowledged repository write must already persist.
process.exit(0);

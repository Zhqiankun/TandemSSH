import fs from "node:fs/promises";
import path from "node:path";
import { transferToolsFixture } from "./transfer-tools-fixture";
import type { TaskFileBindings } from "../../types/task-plan";
import type { WorkflowDefinition } from "../../types/workflow";
export async function parentDirectoryWorkflowFixture() {
  const f = await transferToolsFixture(),
    source = path.join(f.folder, "bundle"),
    destination = path.join(f.folder, "received");
  await fs.mkdir(source);
  await fs.mkdir(destination);
  await fs.mkdir(path.join(source, "empty"));
  await fs.writeFile(path.join(source, "data.bin"), f.bytes);
  // Dynamic parent workflows may use only commands already allowed by the parent grant and policy.
  f.policy.sets.push({
    id: "read-check",
    scope: { type: "global" },
    strictAllowlist: false,
    rules: [
      {
        id: "allow-pwd",
        effect: "allow",
        match: { kind: "program", program: "pwd" },
        reason: "Read-only fixture command",
      },
    ],
  });
  const definition: WorkflowDefinition = {
    schemaVersion: 3,
    id: "parent-directories",
    name: "目录部署流程",
    version: "1.0.0",
    files: {
      artifact: { direction: "upload", kind: "directory" },
      result: { direction: "download", kind: "directory" },
    },
    parameters: {},
    defaults: { cwd: "/srv" },
    steps: [
      {
        id: "up",
        name: "上传目录",
        action: {
          type: "upload-directory",
          path: "/srv",
          localFile: "artifact",
        },
      },
      {
        id: "check",
        name: "检查",
        action: { type: "command", program: "pwd", args: [] },
      },
      {
        id: "down",
        name: "下载目录",
        action: {
          type: "download-directory",
          path: "/srv/bundle",
          localFile: "result",
        },
      },
    ],
  };
  const saved = await f.workflows.save("owner", {
    definition,
    allowedHostIds: [7],
  });
  const bind = async (taskId: string) => {
    const bindings: TaskFileBindings = {};
    for (const direction of ["upload", "download"] as const) {
      const ticket = f.grants.issue("owner", taskId, {
        windowToken: f.windowToken,
        direction,
        kind: "directory",
      });
      f.grants.claim(f.windowToken, ticket.id);
      const g = (
        await f.grants.fulfill(f.windowToken, ticket.id, [
          direction === "upload" ? source : destination,
        ])
      ).grants[0];
      bindings[direction === "upload" ? "artifact" : "result"] = {
        localGrantId: g.id,
        localVersion: g.version,
      };
    }
    return bindings;
  };
  const authorize = (taskId: string) =>
    f.runtime.authorize(f.human, taskId, {
      ...f.control.snapshot(),
      policyRevision: 1,
      shellReady: true,
      maxOperations: 20,
      durationMinutes: 10,
      allowReviewedPlan: false,
      matches: [{ kind: "program", program: "pwd" }],
      fileScopes: [
        { kind: "directory", path: "/srv", access: ["read", "write"] },
      ],
    });
  return { ...f, saved, source, destination, bind, authorize };
}

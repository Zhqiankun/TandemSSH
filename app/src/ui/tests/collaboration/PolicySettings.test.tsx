import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import { evaluateCommandPolicy } from "../../../backend/collaboration/policies/command-policy";
import { validatePolicySets } from "../../../backend/collaboration/policies/schema";
import i18n from "../../i18n/i18n";
const api = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  trial: vi.fn(),
}));
const collab = vi.hoisted(() => ({ targets: vi.fn(), takeover: vi.fn() }));
vi.mock("@/api/policy-api", () => ({ policyApi: api }));
vi.mock("@/api/collaboration-api", () => ({ collaborationApi: collab }));
import { PolicyEditor } from "../../features/collaboration/PolicySettings";
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("zh-CN");
  api.read.mockResolvedValue({
    revision: 2,
    sets: [
      {
        id: "global",
        scope: { type: "global" },
        strictAllowlist: false,
        rules: [
          {
            id: "deny-rm",
            effect: "deny",
            match: { kind: "program", program: "rm" },
            reason: "禁止删除",
          },
        ],
      },
    ],
  });
  collab.targets.mockResolvedValue([
    {
      id: 1,
      name: "Fixture",
      address: "127.0.0.1",
      port: 22,
      groups: ["prod"],
    },
  ]);
  collab.takeover.mockResolvedValue(undefined);
  api.trial.mockImplementation(async ({ sets, command }) => ({
    policyRevision: 2,
    action: { type: "terminal.command", ...command },
    target: { hostId: 1, groupIds: ["prod"] },
    decision: evaluateCommandPolicy(
      { revision: 2, sets: validatePolicySets(sets) },
      { hostId: "1", groupIds: ["prod"], taskId: "task" },
      { type: "terminal.command", ...command },
    ),
  }));
  api.save.mockImplementation(async (revision, sets) => ({
    revision: revision + 1,
    sets: validatePolicySets(sets),
  }));
});
afterEach(cleanup);
async function open() {
  render(<PolicyEditor sessionId="session" hostId={1} />);
  await screen.findByDisplayValue("rm");
}
describe("Chinese policy editor", () => {
  it("evaluates draft rules without saving or authorizing a command", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("试算命令（仅一条）"), {
      target: { value: "/bin/rm /srv/test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "只试算，不执行" }));
    await screen.findByText("规则拒绝");
    expect(api.save).not.toHaveBeenCalled();
    expect(collab.takeover).not.toHaveBeenCalled();
    expect(api.trial.mock.calls[0][0].command).toMatchObject({
      program: "/bin/rm",
      args: ["/srv/test"],
    });
  });
  it("requires an explicit save acknowledgment and sends the expected revision", async () => {
    await open();
    const save = screen.getByRole("button", {
      name: "保存并应用规则",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /我已检查本次规则变更/ }),
    );
    fireEvent.click(save);
    await screen.findByText("规则已保存，旧授权已失效。");
    expect(api.save.mock.calls[0][0]).toBe(2);
    expect(save.disabled).toBe(true);
  });
  it("keeps the user's edits on a revision conflict", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("程序名或绝对路径"), {
      target: { value: "reboot" },
    });
    api.save.mockRejectedValueOnce({
      response: { data: { error: "POLICY_CHANGED" } },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /我已检查本次规则变更/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存并应用规则" }));
    await screen.findByText(/策略已变更/);
    expect(screen.getByDisplayValue("reboot")).toBeTruthy();
  });
  it("retains takeover while a policy save is pending", async () => {
    await open();
    let release!: () => void;
    api.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ revision: 3, sets: [] });
        }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /我已检查本次规则变更/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存并应用规则" }));
    fireEvent.click(screen.getByRole("button", { name: "立即接管" }));
    await waitFor(() =>
      expect(collab.takeover).toHaveBeenCalledWith("session"),
    );
    release();
    await screen.findByText("规则已保存，旧授权已失效。");
  });
});

it("edits file path rules without changing the command rules", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "添加文件规则" }));
  const region = within(screen.getByRole("region", { name: "文件路径规则" }));
  fireEvent.change(region.getByLabelText("绝对路径"), {
    target: { value: "/srv/配置%2F" },
  });
  fireEvent.change(region.getByLabelText("匹配范围"), {
    target: { value: "directory" },
  });
  fireEvent.change(region.getByLabelText("文件权限"), {
    target: { value: "read" },
  });
  fireEvent.click(region.getByRole("checkbox", { name: /严格文件白名单/ }));
  fireEvent.click(
    screen.getByRole("checkbox", { name: /我已检查本次规则变更/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "保存并应用规则" }));
  await screen.findByText("规则已保存，旧授权已失效。");
  const set = api.save.mock.calls[0][1][0];
  expect(set.strictFileAllowlist).toBe(true);
  expect(set.fileRules[0]).toMatchObject({
    effect: "deny",
    match: { kind: "directory", path: "/srv/配置%2F", access: ["read"] },
  });
  expect(set.rules[0].match.program).toBe("rm");
});

it("explains which applicable rule set rejected an allowlist trial", async () => {
  api.read.mockResolvedValue({
    revision: 2,
    sets: [
      {
        id: "group-prod",
        scope: { type: "group", id: "prod" },
        strictAllowlist: true,
        rules: [],
      },
      {
        id: "host-one",
        scope: { type: "host", id: "1" },
        strictAllowlist: true,
        rules: [],
      },
    ],
  });
  render(<PolicyEditor sessionId="session" hostId={1} />);
  await screen.findByDisplayValue("prod");
  fireEvent.change(screen.getByLabelText("试算命令（仅一条）"), {
    target: { value: "df -h" },
  });
  fireEvent.click(screen.getByRole("button", { name: "只试算，不执行" }));
  await screen.findByText("规则拒绝");
  expect(
    screen.getByText(/未命中该范围的白名单.*规则集：分组 · prod/),
  ).toBeTruthy();
  expect(
    screen.getByText(/未命中该范围的白名单.*规则集：主机 · Fixture/),
  ).toBeTruthy();
  expect(api.save).not.toHaveBeenCalled();
});

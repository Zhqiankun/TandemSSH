import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "../../i18n/i18n";
import type { TaskView } from "../../../types/collaboration-task";
import { TaskAuthorizationForm } from "../../features/collaboration/TaskAuthorizationForm";

const task: TaskView = {
  id: "assistant-task",
  sessionId: "session",
  hostId: 1,
  hostName: "server",
  title: "Docker 巡检",
  source: "assistant",
  mode: "collaborative",
  state: "awaiting-authorization",
  nextStep: 0,
  stepCount: 0,
  commands: [],
  operations: [],
  control: {
    sessionId: "session",
    generation: 2,
    controlEpoch: 3,
    controller: { kind: "human" },
    closed: false,
  },
  policyRevision: 7,
  createdAt: 0,
};

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

afterEach(cleanup);

it("starts an assistant diagnostic with one compact authorization action", () => {
  const authorize = vi.fn(async () => {});
  render(
    <TaskAuthorizationForm
      task={task}
      localGrants={[]}
      disabled={false}
      revision={7}
      onAuthorize={authorize}
    />,
  );

  expect(screen.getByText("允许本次诊断")).toBeTruthy();
  expect(
    screen.queryByRole("checkbox", {
      name: /我已确认终端位于命令提示符/,
    }),
  ).toBeNull();
  expect(screen.getByText("docker")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "确认终端空闲并开始" }));

  expect(authorize).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      generation: 2,
      controlEpoch: 3,
      policyRevision: 7,
      shellReady: true,
      maxOperations: 10,
      durationMinutes: 15,
      allowReviewedPlan: false,
      allowReadOnlyAutoRun: true,
      matches: expect.arrayContaining([
        { kind: "program", program: "pwd" },
        { kind: "program", program: "docker" },
      ]),
    }),
  );
});

it("keeps the full authorization editor available when the user adjusts scope", () => {
  render(
    <TaskAuthorizationForm
      task={task}
      localGrants={[]}
      disabled={false}
      revision={7}
      onAuthorize={vi.fn(async () => {})}
    />,
  );

  const details = screen
    .getByText("查看本次授权内容")
    .closest("details") as HTMLDetailsElement;
  expect(details.open).toBe(false);
  fireEvent.click(screen.getByText("查看本次授权内容"));
  fireEvent.click(screen.getByRole("button", { name: "调整授权范围" }));

  expect(
    screen.getByRole("checkbox", {
      name: /我已确认终端位于命令提示符/,
    }),
  ).toBeTruthy();
  expect(screen.getByLabelText("本次允许的程序（每行一个）")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "确认终端空闲并开始" }),
  ).toBeNull();
});

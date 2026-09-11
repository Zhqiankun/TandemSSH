import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18n from "@/i18n/i18n";
import { HistoryRecordSummary } from "@/features/collaboration/HistoryRecordSummary";
afterEach(cleanup);
it("shows Chinese source, target, policy and escaped output", async () => {
  await i18n.changeLanguage("zh-CN");
  render(
    <HistoryRecordSummary
      item={{
        id: "event",
        at: 1,
        type: "operation.completed",
        detail: "token",
        origin: "mcp",
        mode: "collaborative",
        hostName: "测试服务器",
        policyRevision: 3,
        policyOutcome: "confirm",
        exitCode: 0,
        cwd: "/srv",
        outputPreview: "<script>not executable</script> [redacted]",
        outputTruncated: true,
      }}
    />,
  );
  for (const text of [
    "来源: MCP",
    "模式: 协作",
    "服务器: 测试服务器",
    "策略版本: v3",
    "策略判断: 要求确认",
    "退出码: 0",
    "目录: /srv",
  ])
    expect(screen.getByText(text)).toBeInTheDocument();
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getByText(/not executable/)).toBeInTheDocument();
});
it("labels missing source and host as unrecorded", async () => {
  await i18n.changeLanguage("zh-CN");
  render(
    <HistoryRecordSummary
      item={{ id: "old", at: 1, type: "event", detail: "token" }}
    />,
  );
  expect(screen.getByText("来源: 未记录")).toBeInTheDocument();
  expect(screen.getByText("服务器: 未记录")).toBeInTheDocument();
  expect(screen.queryByText("人工")).not.toBeInTheDocument();
});

it("shows a recorded unknown decision as manual review rather than omitting it", async () => {
  await i18n.changeLanguage("zh-CN");
  render(
    <HistoryRecordSummary
      item={{
        id: "unknown",
        at: 1,
        type: "operation.proposed",
        detail: "token",
        origin: "agent",
        policyRevision: 4,
        policyOutcome: "unknown",
      }}
    />,
  );
  expect(
    screen.getByText("策略判断: 无法自动判定，需人工审查"),
  ).toBeInTheDocument();
  expect(screen.queryByText("策略判断: 允许")).not.toBeInTheDocument();
});

it("explains an unknown execution result in Chinese without showing a successful exit", async () => {
  await i18n.changeLanguage("zh-CN");
  render(
    <HistoryRecordSummary
      item={{
        id: "interrupted",
        at: 1,
        type: "operation.completed",
        detail: "token",
        status: "unknown",
        error: "RESULT_UNKNOWN",
      }}
    />,
  );
  expect(
    screen.getByText("失败/中断原因: 结果未知，请人工核对后决定下一步。"),
  ).toBeInTheDocument();
  expect(screen.queryByText("退出码: 0")).not.toBeInTheDocument();
});
it("renders an unrecognized recorded reason as escaped text", async () => {
  await i18n.changeLanguage("zh-CN");
  render(
    <HistoryRecordSummary
      item={{
        id: "failure",
        at: 1,
        type: "operation.completed",
        detail: "token",
        error: "<script>error detail</script>",
      }}
    />,
  );
  expect(screen.getByText(/error detail/)).toBeInTheDocument();
  expect(document.querySelector("script")).toBeNull();
});

it("distinguishes file writes and uncertain commits without inventing terminal output", async () => {
  await i18n.changeLanguage("zh-CN");
  render(
    <HistoryRecordSummary
      item={{
        id: "file",
        at: 1,
        type: "operation.completed",
        detail: "token",
        actionType: "file.write",
        status: "unknown",
        fileBytes: 27,
        fileCommitMayHaveOccurred: true,
      }}
    />,
  );
  expect(screen.getByText("操作: 保存文件")).toBeInTheDocument();
  expect(screen.getByText("已处理 27 字节")).toBeInTheDocument();
  expect(screen.getByText(/文件操作结果尚未确认/)).toBeInTheDocument();
  expect(screen.queryByText("退出码: 0")).not.toBeInTheDocument();
});

it("labels unrecognized legacy file action types generically", async () => {
  await i18n.changeLanguage("zh-CN");
  render(
    <HistoryRecordSummary
      item={{
        id: "legacy-file",
        at: 1,
        type: "operation.completed",
        detail: "token",
        actionType: "file.directory",
      }}
    />,
  );
  expect(screen.getByText("操作: 文件操作")).toBeInTheDocument();
});

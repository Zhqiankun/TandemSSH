# MCP 接管后的错误契约修复

2026-09-12，针对原验收 A07（无控制权时返回 CONTROL_BUSY / STALE_CONTROL）。

## 发现与修复

新增 MCP SDK 集成测试经过实际 CoreService、TaskRuntime 和 SessionControl：创建自动或协作任务，桌面授权后人工输入触发接管，再由原 MCP 任务提交 pwd。两种模式最初均返回 TASK_NOT_RUNNING，与约定的控制权错误码不一致。写入原本已被拦截，本次修正的是可供客户端识别的错误契约。

TaskRuntime 的操作提议入口对 paused-human 返回 STALE_CONTROL；其他未运行状态继续保持原错误语义。MCP 适配器新增 CONTROL_BUSY 中文提示，要求停止写入并等待用户明确授权；保留 STALE_CONTROL 的交还提示。未增加自动授权或重试入口，未改变权限范围。

文件责任：runtime.ts 负责权威任务状态和错误语义；mcp/server.ts 负责协议及中文响应；测试使用已有 transferToolsFixture，通过公开核心入口调用，未新增共享抽象或依赖方向。

## 验证

- 新集成测试 automatic / collaborative 两模式：isError=true，错误码为控制权错误，人工接管后的写入数组不变，控制权仍为 human。
- MCP 协议测试分别核对 CONTROL_BUSY / STALE_CONTROL 的结构化错误、中文文字、无成功 result、仅一次核心调用。
- 本轮 4 文件 / 55 测试通过，报告 .cache/mcp-control-contract-results.json。
- 修改文件 ESLint 与 npm run type-check 均通过。

测试使用内存 MCP 传输和受控 SSH 写入夹具；没有将本轮称为实际 Codex stdio 或远端 SSH 重跑。尚未覆盖 A07 的全部并发入口，因此不将整个条目标记完成。修复位于开发分支，已公开的 alpha.4 安装包不含此变更。

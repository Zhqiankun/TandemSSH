# 终端包装回显与真实输出的边界验证

## 现状

第 244 号桌面截图中存在内部命令包装回显。当前 CommandFrameDecoder 只提取任务结果，并不修改 SSH 实时终端流。TerminalSessionManager 原样保留输出用于终端、缓冲和录制；因此不能把任务结果过滤误当成已有终端显示过滤。

该可读性问题尚未修复。本轮未改变生产输出或接管协议，避免按 __tandem_ 等字符串删除用户真实输出。

## 实验

扩展既有 pty-integration.test.ts 的 withTerminal 夹具，允许显式列宽（默认保持 160），暴露有界 128000 字符原始输出供断言。没有新增生产模块或共享抽象。

通过真实 Windows ConPTY + 项目 Git Bash，分别使用 40 列、80 列执行 printf 输出 __tandem_visible_result：

- 两次退出码均为 0。
- 提取的任务结果保留完整合法标记文本，且不包含 if command printf 包装前缀。
- 原始终端仍存在包装文本。

命令：设置 TANDEM_TEST_BASH 与 TANDEM_PTY_TRACE=1 后运行 vitest run src/backend/tests/collaboration/pty-integration.test.ts -t 'preserves genuine marker-like' --maxWorkers=1。

日志 .cache/narrow-pty-results.log：2 项通过、11 项因名称筛选跳过。只证明本轮两个场景，不能写成整套 PTY 通过，也不是新桌面视觉验收。

## 后续实现边界

显示优化必须使用本地已发送命令的身份与精确回显证据，限定在终端显示交付层；任务结果、审计、录制与原始输出缓冲不能被反向修改。遇到未知回显、包分割、超时或人工接管，应保留原始数据，不能继续隐去可能属于人工的输出。

禁止使用关键词删除、远端 stty -echo 或静默改用独立 Shell 来隐藏包装。必须覆盖 CSI/OSC、UTF-8 分包、折行、接管时尚未完成回显、恢复缓冲以及合法同名输出，再进行最新桌面验收。

这是一项未完成的显示改进及其实际验证基线，不将原验收项改为完成。本轮没有提交、推送或发布。

# 聊天接收与执行容量

状态：单次聊天接收/执行/发送边界已实现，专项、全量与原生 Windows 验收通过。

本轮负责普通 AI 聊天的流式生命周期与单次执行容量。ui/features/ai/use-ai-stream 仅编排当前请求身份、取消与 React 状态；聊天专用 stream reader 负责接收预算和协议完成状态，不修改其他长期 SSE 订阅。旧请求不得更新新请求状态或清理新控制器，停止/重置/卸载都取消当前读取；失败不调用完成回调，保留已显示片段并给出中文说明。

ai/engine 对每次模型调用前上下文、单轮文本与工具调用作容量检查，完整模型轮结束且预算通过后才派发工具；取消后不派发。工具结果超限时不继续下一模型轮。沿用现有工具目录及审批权限，不新增通用 helpers 或反向 UI 依赖。

预定边界：上下文 JSON UTF-8 128 KiB，单轮文本 16 KiB、8 个工具、合计 64 KiB 工具参数；8 轮原预算不变。前端单请求最多 4 MiB 接收、256 Ki UTF-16 码元单行、65536 行、128 KiB 文本、64 个工具和提案；仅当前请求能更新状态，每 20 ms 合并一次显示更新。60 秒无数据或 30 分钟总时长结束读取；后端已有模型网络预算，心跳不意味着完成。

验收：旧请求迟到/异常不能覆盖新请求；停止、重置、卸载取消读取；无换行或持续事件超限；分块中文；错误或缺失 done 不假成功；上下文/文本/工具/参数/结果超限阻止后续工具/模型调用。历史数据库分页和服务端 SSE 背压继续单独核查，不把本轮称为所有聊天存储已受控。

发送链路同时接通 ai/chat-delivery：每次 SSE write 必须等待 drain 后才继续消费模型或工具事件，单帧/待发送容量 256 KiB、单请求 4 MiB，15 秒不排空则取消模型并关闭连接。心跳不在背压期间追加。响应 close 触发取消，工具调用事件发送后再次核对取消，防止在 UI 停止时仍派发。该模块只依赖 Node HTTP 和 AbortController，归属聊天传输；不会用于永久 SSE。

源码核对还发现普通聊天 fetch 没有沿用 Electron 的认证头；现与既有隧道 SSE 一致，在 Electron 下通过 main-axios 的平台判断附加 X-Electron-App 和当前 JWT，浏览器继续使用 Cookie。该修复不放宽服务端认证。

## 代码验证

25 个聊天与 AI 专项文件、171 项测试通过。新覆盖旧 fetch 迟到拒绝、最终批次文本、错误/缺少 done 不触发完成回调、停止/重置/卸载取消 reader、累计文本、UTF-8 拆包、无换行、极小帧数量、HTTP 错误、静默读取超时、Electron 认证头，以及发送背压、取消和累计预算。执行器验证大上下文不请求模型，文本/工具超限不派发已收到工具，工具结果超限不请求下一轮，以及可见工具事件交付期间取消后不调用 handler。

全量回归 499 个文件通过、1 个跳过；3554 项测试通过、12 项跳过，271.42 秒。命令 vitest run --exclude src/backend/tests/collaboration/pty-integration.test.ts --maxWorkers=2；独立 ConPTY 门禁仍由 CI 单独验证。lint 为 0 错误、既有 100 警告。日志 .cache/chat-stream-ai-tests.log、chat-stream-regression.log、chat-stream-lint.log。

尚未完成：历史记录查询/分页与持久化容量、面板完成后的异步历史刷新竞争、跨请求的部分回复保存、所有全局并发预算。当前保留片段指当前回复显示状态，不宣称异常片段已经写入历史数据库。

## 原生 Windows 验收

在新的隔离用户目录中开启 AI 并配置仅回环监听的模型，用真实界面依次发送 NORMAL、HOLD、NEXT、OVERFLOW、RECOVER。正常回复显示“普通聊天中文完成”；HOLD 显示片段后点击停止，测试模型的真实 HTTP 连接关闭；NEXT 独立显示“新请求独立完成”；17000 字节模型文本触发单轮上限，显示中文超量错误；RECOVER 随后显示“错误后继续成功”。测试模型恰好收到 5 次请求，无额外重试，未调用付费模型。

证据 .cache/desktop-observation-report-3282648c-9e33-47b0-b778-a8fdc5461a4b/chat-stream-result.json；截图 chat-after-stop.png、chat-overflow.png、chat-recovered.png；日志 .cache/chat-stream-desktop.log。应用正常退出、测试模型关闭、应用测试端口释放。本轮验证的是普通聊天；共享 SSH 的自动/协作核心由既有回归覆盖，上一轮真实双模式验证见 68，不用本次无 SSH 的聊天截图替代。

最终类型、构建和中文词条检查通过；Windows 包的 13 项原生依赖探测、3 项打包 MCP 测试通过，隔离 Codex 发现 38 项工具。日志 .cache/chat-stream-types.log、chat-stream-build.log、chat-stream-localization.log、chat-stream-native-probe.log、chat-stream-package-mcp.log。隔离用户目录检查 6 个配置/日志/数据库文件，未发现测试模型 Key 的 UTF-8/UTF-16 明文，未解密数据库。扫描记录 .cache/chat-stream-privacy-check.json。

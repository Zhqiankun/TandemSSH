# 模型 HTTP 响应边界

状态：已实现，实际 HTTP/SDK、全量回归与 Windows/Linux 双模式验收通过。

任务执行器已有 60000 字符上下文、16000 字符单次文本和 8 个工具调用限制；本轮补齐其下层 HTTP 响应约束，不把这些局部上限称为所有聊天历史已受控。

ai/providers/response-budget.ts 归属模型网络适配层，负责每次请求 8 MiB 响应体字节（HTTP 解压后、文本解码前）、60 秒无网络数据和 180 秒总耗时，取消、读取完成和错误都释放资源。http.ts 继续唯一负责出口权限选择，并为私网代理和公网安全请求接入同一预算；所有供应商（含 Anthropic SDK）、模型列表和错误体均受此约束。响应超限明确失败，不把截断内容伪装成完整模型响应；没有自动重试、切换端点或权限扩张。已有人工 SSH 不依赖模型网络。

SSE/JSONL 读取提前结束时必须取消响应，不能仅释放 reader 锁让网络继续。Anthropic SDK 使用公开请求选项传入取消信号，退出迭代时中止 SDK 流，并关闭 SDK 隐式重试，避免在暂停后继续请求。稳定错误码为 MODEL_RESPONSE_TOO_LARGE、MODEL_RESPONSE_TIMEOUT；任务界面和聊天面板使用中文说明。依赖仅从 UI/执行器到供应商公开接口，预算模块不依赖 UI、数据库或任务内部状态。

验收：实际回环 HTTP 中文拆包正常、超量响应取消、静默/总超时、提前退出、用户取消、SDK 实际取消、非法配置、工具参数碎片与错误体超限；既有 AI 自动/协同暂停与旧租约拒绝回归。仅隔离测试供应商，不调用付费模型。

## 已完成的代码验证

20 个 AI 测试文件、136 项测试通过；其中新增 9 项响应预算、3 项实际 Anthropic SDK 生命周期、2 项自动/协作模式故障派发验证。真实回环 HTTP 证明中文跨数据块解码、无换行的超量响应被取消、结束标记提前返回后关闭连接、等待响应头超时和超量错误体保留原因。可控时钟证明静默、持续数据下总超时、用户取消与计时器清理。SDK 的实际 HTTP 测试证明 429 不隐式重试、消费端提前退出关闭连接、8 MiB 超限错误保持可识别。

两种任务模式均验证：收到工具调用后流出错，任务进入 paused-error，未将该工具交给 SSH 写入端口，人工输入仍能写入。该测试使用真实任务/控制核心和模拟 SSH 端口；不会把它单独称为真实远端文件验收。

最终全量应用回归：496 个测试文件通过、1 个跳过，3531 项通过、12 项跳过，273.28 秒。命令 vitest run --exclude src/backend/tests/collaboration/pty-integration.test.ts --maxWorkers=2；独立 ConPTY 门禁仍交由 CI 单独验证。类型检查通过，lint 0 错误/既有 100 警告，中文词条缺失为 0。日志 .cache/provider-response-ai-tests.log、provider-response-regression.log、provider-response-types.log、provider-response-lint.log、provider-response-localization.log。

本轮仅覆盖供应商 HTTP 响应生命周期。普通聊天的历史数据库查询、累计消息/工具上下文、前端聊天 SSE 队列和全局并发预算仍需继续核查；本轮不宣布全部模型上下文边界完成。

## 真实 Windows/Linux 双模式验收

本轮使用固定 Alpine 3.24.1 实验机 920c8525-3e39-4612-a343-967578101d89，经交互认证跳板和目标建立真实 SSH Shell；模型只运行在本机回环地址，不调用商业模型。分别建立 automatic 与 collaborative 任务，模型先返回中文计划；人工在中文界面核对范围并授权后，模型响应包含一个 touch 工具片段，随后持续发送超过 8 MiB 的无换行内容。

两种模式均进入 paused-error，中文显示“模型响应超过容量上限”。独立 SFTP 核对 forbidden-automatic 和 forbidden-collaborative 均不存在；人工随后在同一 SSH 终端输入 touch，SFTP 核实 manual-automatic 和 manual-collaborative 存在。模型共接收 4 次请求（每种模式各 1 次计划、1 次执行），两个超量连接均被关闭，没有重试请求。

成功证据 .cache/desktop-observation-report-4ef57979-3d39-4621-bbe3-02c81c52bca7/provider-response-result.json，截图 provider-overflow-automatic.png 和 provider-overflow-collaborative.png；日志 .cache/provider-response-desktop.log。首次脚本遗漏打开“协作执行”面板，停在任务选择器等待，任务实际处于 awaiting-authorization；修正操作步骤后复测通过，没有因此改动产品逻辑。首次失败报告 c531bb70-8959-4340-8e1a-9467c136b285 保留，不计通过。

最终 Windows 包通过 13 项原生依赖探测、3 项打包 MCP 测试，隔离 Codex 发现 38 个工具。日志 .cache/provider-response-native-probe.log、provider-response-package-mcp.log。两个隔离用户目录各扫描 7 个配置、日志和数据库文件，未发现测试密码、验证码和测试模型 Key 的 UTF-8/UTF-16 明文，未解密数据库；记录 .cache/provider-response-privacy-check.json。测试应用和实验机正常退出，SSH/QMP 与应用测试监听端口均释放。

这些证据覆盖本轮网络故障及任务暂停，未重新宣称公开发行、所有基础认证/文件/隧道矩阵、长对话历史和全部目标验收已经完成。

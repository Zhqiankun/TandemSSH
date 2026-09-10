# 终端输出容量与缺口处理

状态：已实现输出确认、发送预算、历史边界和中文恢复入口，真实 Windows/Linux 验收通过。最终应用回归及打包检查通过；录制写队列和完整模型上下文的其他边界仍继续核查。

## 模块与契约

terminal/output-delivery.ts 维护每个 WebSocket 的发送/未确认预算和关闭生命周期，不保存输出内容副本。session-manager 维护历史窗口、缺口状态和控制权撤销；终端接口负责能力协商、回放与 ACK 输入；前端在 xterm write 回调完成后确认，并显示中文提示。MCP 通过 getOutputSnapshot 公开入口读取历史边界，不再自行根据会话私有字段计算。

新界面在 WebSocket URL 声明 outputAck=1。协商后的 data 消息带本连接递增 deliveryId；客户端累计确认实际发送过的 ID。旧确认幂等，未来 ID、非法数值以及另一连接的 ID 不能释放本连接未发送的额度。确认仅影响自己的输出账本，不授予终端输入权限，只读参与者也可以确认收到的数据。

每连接上限为 4 MiB 未确认的序列化数据和 1024 个未确认帧，同时限制 WebSocket bufferedAmount。未协商客户端保留旧消息格式，仍受网络发送缓冲限制，但不宣称其渲染队列受到新 ACK 约束。

超限后停止给该窗口追加输出，以 1013 / TERMINAL_OUTPUT_OVERFLOW 关闭，最多一秒后终止仍未关闭的连接。若是主窗口，先同步撤销自动任务租约，既有控制订阅会暂停任务、取消未发送操作或把在途结果标为未知；慢速访客只关闭自己，不能暂停主窗口。缺口状态不会因单纯重连而消失，前端显示核对提示；关闭提示本身不恢复授权。

历史窗口按 UTF-8 字节限制为 512 KiB，同时最多保留 4096 块。裁剪设置截断标记；请求超出窗口或首次读取已经截断的历史时，MCP 返回 contextGap/truncated。滚动历史正常淘汰不会打断仍完整接收实时输出的主窗口。SSH 命令结果解析仍直接读取真实 SSH 流，不依赖有限的 UI 历史。

## 专项验证

终端发送、会话和 MCP 共 99 项专项测试通过，包括 10 项新增场景：累计/重复/非法/未来/跨窗口确认、字节与帧数预算、旧协议网络缓冲、异步发送失败、真实 WebSocket 消费了传输数据但不确认渲染的情况、UTF-8 与极小块历史限制、主窗口超限后的旧租约写入拒绝、访客隔离，以及 MCP 首次读取缺口。两项旧测试适配了新增的发送失败回调参数，原消息内容断言保留。

类型检查、构建、修改文件 lint 已通过。最终应用回归 493 个测试文件通过、1 个跳过；3508 项通过、12 项跳过，约 267 秒。命令为 vitest run --exclude src/backend/tests/collaboration/pty-integration.test.ts --maxWorkers=2，独立 PTY 门禁不包含在此结果中。最终 Windows 包的 13 项原生依赖探测、3 项打包 MCP 测试通过，隔离 Codex 可发现 38 个工具，中文翻译键缺失为 0。全量回归首轮另发现文件面板测试提前断言目录目标回调：路径输入框先更新，异步列目录完成后才确认目标，中间正确返回 null。改为等待原目标回调断言，不调整产品逻辑或超时；文件面板五项专项复测通过。

## 实际 Windows 验收

实验机使用固定 Alpine 3.24.1 镜像，本次编号 2be5eb60-c8ee-4666-8f55-a77d2aba66eb，SSH/QMP 仅回环监听，无宿主共享。测试通过需要人工验证码的跳板机和目标认证入口连接真实 Linux Shell。

正常窗口完成 31457280 字节 / 30000.66 ms 的持续输出，负载下 20 次接管 p95 为 16.1 ms，没有触发超限关闭。证据为 .cache/desktop-observation-report-168ea480-4652-4c64-a316-71cec6a5a0e3/terminal-pressure-result.json。延迟及生成负载的测量口径与 65 相同，不推广为所有机器/网络的性能承诺。

故障注入只暂停本次测试应用渲染器的 JavaScript，不暂停后端或 Linux：

1. 建立并授权真实自动任务，确认窗口已经发送渲染 ACK。
2. 持续输出期间暂停渲染器，服务端达到预算后将任务切为 paused-human。渲染器仍暂停时通过 MCP 验证状态，后续 touch 请求被拒绝，独立 SFTP 核实目标文件不存在。
3. 恢复渲染器，窗口收到 1013 和明确原因，显示中文缺口提示。MCP 首次读取也返回缺口及截断，文本不超过请求的 2000 字符。
4. 人工重新连接恢复原 SSH 会话，缺口提示仍在；核对并重新授权后，实际 Linux touch 成功并独立核对文件存在。

首轮发现断开后没有重连按钮，已补上既有断开覆盖层。第二轮发现普通重连会重新发起 SSH 登录，现仅在明确的输出超限关闭后优先恢复仍存活的原会话；服务端既有附加鉴权和会话失效回退保持有效。未重新登录跳板或目标，最终目标认证计数仍为 1。

最终结果 .cache/desktop-observation-report-4840df0f-09d3-41a7-903b-b1fc2f6ec569/terminal-output-result.json：暂停前已发送 326 次 ACK；包括暂停前正常输出在内，测试源停止前发送 5544116 字节。该总数不是单窗口未确认占用值。automaticTaskPaused、noWriteAfterGap、mcpGapVisible、manualReconnect、reauthorizationRequired、recoveredWrite 均为 true。截图 terminal-output-gap.png、terminal-output-recovered.png；日志 .cache/terminal-output-desktop-restored.log。

首轮和第二轮失败分别留存在 .cache/desktop-observation-report-fdd53447-9b28-4525-8607-333c62b79f3b 与 .cache/desktop-observation-report-630f22f9-3b82-4af0-ac11-ded3448f4441。客户端最终正常退出，实验机正常关闭，管理进程退出码 0。

## 仍需完成

录制写入积压、其他输出/模型上下文队列和长期资源回收继续核查。本轮不替代 docs/06-delivery.md 的全部 A15，也不宣称所有历史内容都能恢复。旧后端未协商 ACK 的能力边界、完整认证/权限撤销矩阵及其余基础功能验收保持原范围。

验证日志：.cache/terminal-output-contract-tests.log、terminal-output-regression-final.log、terminal-output-package-mcp.log、terminal-output-native-probe.log。两个成功桌面用户目录各检查 7 个配置、审计和日志文件，未发现测试密码或跳板验证码的 UTF-8/UTF-16 明文；未解密数据库。记录 .cache/terminal-output-privacy-check.json。

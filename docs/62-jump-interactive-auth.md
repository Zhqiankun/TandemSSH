# 跳板机交互认证

状态：终端和 SFTP 已接入，完成真实双跳协议测试及 Windows 单跳文件传输、取消验收。监控和其他后台调用尚未接入；完整认证矩阵仍未完成。

## 责任和协议

jump-host-chain 编排各跳连接、主机信任、转发和整链资源释放，通过 interactive-auth/production 的公开入口处理人工认证。认证模块负责提示所属用户、时限和回复前主机权限复查，不依赖 SFTP 或终端页面。已有中文弹窗显示跳板机实际地址、端口和用户名；服务器问题原样显示。每跳使用独立连接和提示 ID，不能将前一跳答案用于后一跳。

createJumpHostChain 新增可选第四参数 interaction={keyboardInteractiveVersion:1,onPrompt?}，第三参数仍为既有 AbortSignal。SFTP 和终端在界面已协商该能力时启用；未协商的后台调用保留原行为，不自动创建需要人工回答的问题。onPrompt 通知调用方等待人工，认证内核仍保留每跳 300 秒总上限；调用方整体超时也有效。终端完成跳板连接后恢复目标连接的普通超时。

待建立终端跳板链绑定本次连接的 AbortController，WebSocket 关闭或认证清理会取消；已经交给共享会话的连接不因界面脱离而在此处关闭。迟到的 forwardOut 回调销毁本次返回的流。最后一跳关闭时，无论调用方是否提供 signal，都关闭前置跳板。SFTP 沿用本次待认证连接的 signal。

跳板认证的 SSH_AUTH_* 错误保留原码：SFTP 返回非 401 的认证失败，终端发送既有 keyboard_interactive_error 终止事件。界面显示中文认证错误并停止自动重试；人工重连仍可创建新尝试。没有数据库迁移，也没有新增通用共享抽象。

## 实际验收（2026-09-10）

新增 3 项真实 SSH 协议测试，覆盖两跳分别提问及原始空白回复、旧 ID 拒绝、末跳执行后读取实际字节、末跳关闭释放前置连接、取消第二跳关闭整链、调用方取消、主机访问撤销后不发送答案。此组为连接管理与授权验证，主机解析、数据密钥和 hostVerifier 使用受控适配；真实信任阻断由现有 tunnel-trust 测试独立覆盖。两组共 27 项通过。

Windows 目录包使用隔离用户目录和本机 SSH/SFTP 服务：先人工核对跳板机指纹和回复验证码，再核对目标指纹、完成目标多轮认证；经跳板机上传 8388621 字节、下载 8388625 字节，独立核对文件内容一致。终端使用相同已保存跳板配置，在中文弹窗取消后服务器连接关闭且未收到答案。只有本机文件目录选择框使用固定测试路径注入。

补测发现：取消跳板机认证后，SFTP 的原错误包装丢失认证错误码，界面自动再次发起认证。修复后重新启动独立 Windows 用户目录，验证文件取消后等待 6.5 秒没有新提示、有人工重连入口；终端取消后同样无自动重试；关闭本次测试拥有的终端 WebSocket 后提示移除、跳板机连接关闭，没有额外答案。最后一项直接操作本次测试捕获的 WebSocket，不作为点击标签关闭的替代证明。

验证记录：

- 类型检查、前后端构建、Windows 目录打包通过；最终错误映射修复后后端重新构建并重新打包。修改文件 lint 为 0 错误、0 警告。
- 错误映射补丁前的应用回归：491 个测试文件通过、1 个跳过；3493 项通过、12 项跳过，约 263 秒。命令为 vitest run --exclude src/backend/tests/collaboration/pty-integration.test.ts --maxWorkers=2，不包含独立 PTY 门禁。
- 最终补丁后：认证、信任、人工界面、重试以及打包 MCP 的 8 个文件、46 项专项测试通过；上述取消桌面场景重新实测通过。没有将补丁前的全应用结果声称为补丁后的全应用结果。
- 最终打包原生探测 13 项通过，MCP 三项包含在上述 46 项中，隔离 Codex 配置可发现 38 个工具。
- 两次成功桌面用户目录各扫描 7 个配置/审计/日志文件，未检出测试密码和验证码的 UTF-8/UTF-16 明文；未解密数据库，不代替完整敏感信息审计。

本机证据（不随源码发布）：

- 传输与终端提示：.cache/desktop-observation-report-a54a711a-8b23-4d17-a0fa-c353c157aa33/jump-auth-result.json，含 jump-files-prompt.png、jump-terminal-prompt.png。
- 取消后自动重试的失败：.cache/desktop-observation-report-ff393a52-f8bb-4716-8f0e-129b0be20317，以及 .cache/jump-cancel-desktop-before.log。
- 修复后取消实测：.cache/desktop-observation-report-41047270-8b41-444f-9f7e-29fa535862b7/jump-cancel-result.json；fileJumpCancellation、terminalCancelNoRetry、terminalSocketClose 均为 true。
- .cache/jump-interactive-contract.log、jump-interactive-regression.log、jump-interactive-final-tests.log、jump-auth-native-probe.log、jump-auth-privacy-check.json、jump-cancel-privacy-check.json。

## 仍需完成

监控接入共享交互认证、完整凭据/代理/重连组合，以及经跳板机完成终端自动执行与人机协作的实际验收仍需继续。此前直接终端的双模式验收不自动证明跳板机链路；真实 Linux PAM、完整多跳桌面矩阵和标签关闭行为也不能由本次回环服务或 WebSocket 关闭测试代替。公开 Release 和原需求其他未完成项保持原范围。

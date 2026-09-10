# 监控交互认证

状态：监控人工连接已接入共享认证队列，真实 Windows 客户端完成多轮认证、Linux 指标显示、取消和人工重连。完整应用回归及打包检查已通过；监控经跳板机的完整桌面组合仍需继续验收。

## 模块和协议

metrics/index.ts 编排人工 start 路由和采样，通过 interactive-auth/production 的公开入口发布提示；每次回复重新检查用户数据密钥、当前主机访问权限、地址/端口/用户名，以及监控权限、启用状态和暂停状态。提示和答案不经过监控采样命令接口。待连接注册表维护窗口身份和资源，明确支持最长五分钟人工握手时限。

useMetricsViewer 为本窗口持有 viewerSessionId、AbortController 和已认证标记。离开页面先中止本窗口请求，再释放服务端窗口；旧请求的迟到结果不能覆盖新租约。认证成功但首轮指标暂未返回时复用原连接，避免每次采样重试都销毁 SSH 会话。页面负责中文错误和重试状态，API 只转换协议，不增加新的共享抽象或数据库表。

POST /metrics/start/:id 增加 keyboardInteractiveVersion:1，保留既有 viewerSessionId。新协议保持请求等待，提示由 /ssh-interactive 获取；认证取消、超时和失败返回 409 和完整 SSH_AUTH_* 错误码，不触发应用退出。用户可人工重新连接，旧提示不能用于新尝试。未协商调用保留旧 TOTP 协议。跳板链在同一待连接取消信号下启用已实现的交互协议。

没有预存凭据的主机可以人工回答问题后采样。supportsMetrics 仅在当前用户存在已认证监控会话时允许这类主机参与采样；后台定时器不启用共享人工提示，不在会话缺失时悄悄发起新的交互登录。已保存凭据的后台路径保持既有行为。监控命令仍通过既有只读采样边界执行，不能提交 SSH 登录答案。

## 真实验收与修复

使用既有固定 Alpine 3.24.1 镜像，在本机 QEMU 启动独立实验机，SSH/QMP 只绑定回环地址、无宿主共享。本次编号 641e2577-a346-4d8e-9e2e-28dd473d5a13，SSH 8417、QMP 8418；结束后正常关闭，管理进程退出码 0，相关端口已释放。

Windows 客户端连接本机受控 MFA SSH 入口，入口将仅允许的 cat /proc/meminfo 和 cat /proc/uptime 转发到真实 Linux SSH 服务。多字段密码、保留空白和空字符串回复走实际 SSH 协议；这验证应用与真实 Linux 采样，不代表 Linux PAM 自身的 MFA 配置。未连接生产服务器、未调用付费模型、未改日常 Codex 配置。

首轮发现取消后的离线空白页遮住人工重连按钮，修复 showOffline 渲染条件后复测。进一步查看截图发现：API 已读到指标，页面仍显示离线；首次采样尚未可用时，旧重试逻辑会关闭刚认证的连接。补上租约已认证标记及复用逻辑，并增强桌面判据，要求监控卡片实际出现 Linux 内存数值。

最终通过的场景：

- 人工核对主机指纹后，回答租户/隐藏密码两个字段及空回复，密码空白原样保留。
- 读取真实 Linux 内存和运行时间；API 内存总量为 0.95 GiB，与独立 Linux 读取基线核对，中文卡片实际显示数据。
- 在另一个监控连接取消登录，服务器连接关闭且没有发送答案；观察 6.5 秒无新认证提示，人工重连按钮存在。
- 人工重连得到新提示，旧 ID 回复返回 404；正常认证后再次看到指标卡片。
- 最终两次成功认证共四次回复、四条允许的采样命令；无其他命令。测试应用正常退出。

本机证据（不随源码提交）：

- 最终 .cache/desktop-observation-report-abaaaedd-6a58-4179-9c2b-e39392164fcd/monitor-auth-result.json；cardsVisible、cancelNoRetry、manualRetry、oldIdRefused 均为 true。截图 monitor-auth-reconnected.png 展示实际卡片，monitor-auth-multiple.png 和 monitor-auth-cancelled.png 展示认证及取消状态。
- 首轮失败 .cache/desktop-observation-report-86117d60-0477-4093-9b73-16bc77dd2bfe，阶段 monitor-auth-manual-retry。
- 中间验证 .cache/desktop-observation-report-9c090df1-f6f8-4a91-bf84-2c054c6c3e9f 只证明 API 数据及取消流程，其早期截图仍显示离线，不作为卡片完成证据。
- .cache/monitor-auth-desktop-cards.log、monitor-auth-linux-lab.log、monitor-auth-types-final.log、monitor-auth-contract-final.log、monitor-auth-lint-cards.log。
- .cache/monitor-auth-privacy-check.json：扫描最终独立用户目录中 7 个配置、审计和日志文件，未检出测试密码的 UTF-8/UTF-16 明文；没有解密数据库，不代替完整敏感信息审计。

## 验证范围和剩余工作

专项测试 45 项通过，包括新增的五分钟时限及范围限制、无凭据监控复用边界、取消 HTTP 请求后新租约不受影响、等待首次采样时复用已认证窗口。类型检查、构建和修改文件 lint 通过。

最终应用回归：491 个测试文件通过、1 个跳过；3497 项通过、12 项跳过，用时约 270 秒。命令为 vitest run --exclude src/backend/tests/collaboration/pty-integration.test.ts --maxWorkers=2；该结果不包含独立 PTY 门禁。最终 Windows 包的 13 项原生依赖探测和 3 项打包 MCP 测试通过，隔离 Codex 可发现 38 个工具；字面量中文翻译键缺失为 0。日志分别为 .cache/monitor-auth-regression.log、monitor-auth-native-probe.log、monitor-auth-package-mcp.log。

监控经跳板机的实际桌面组合、认证后的长期断线重连及共享权限撤销矩阵仍需继续。监控字段全集、历史聚合、经跳板机运行 AI 自动任务及人机协作、独立 PTY 验收和公开 Release 等原需求保持原范围，不以本次内存/运行时间场景代替整个项目验收。

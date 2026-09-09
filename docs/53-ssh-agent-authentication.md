# SSH agent 与私钥认证兼容

本阶段继续 B02。主智能体独立实施，先复用现有终端/文件/跳板使用的 SSH agent 适配器补监控接线，再验证真实 SSH 登录与 Windows 命名管道 agent 协议。测试使用临时密钥和独立管道，不连接用户日常 agent、不修改系统服务或日常 SSH 配置。

文件责任：`terminal-auth-helpers.ts` 负责 agent 地址解析、指定公钥和签名适配；监控 `index.ts` 只将已解析主机的 agent 配置接入现有握手；现有终端/文件连接继续使用公开适配器入口。测试夹具拥有私钥和签名进程/管道，应用只通过 agent 协议请求公钥与签名。命令执行继续遵循既有自动/协作/MCP 网关。

验收包括密码、带口令私钥、agent 指定公钥的真实 SSH 认证；确认主机指纹前不查询 agent 或签名；错误身份不能替代所选身份；中文配置提示。Windows OpenSSH 服务安装、其他 agent 产品、全部隧道认证组合和完整 B02/F/B/R/A 验收不因单一夹具通过而提前宣布完成。

## 实施与协议验证

监控连接现已复用 `applyAgentAuth`，接入主机配置中的 agent socket 与指定公钥。Windows 未提供显式地址且没有 SSH_AUTH_SOCK 时，使用标准 OpenSSH agent 命名管道；非 Windows 保留原有环境变量/显式路径规则。没有探测或修改系统 agent 服务，配置提示已更新中英文。

真实临时命名管道 agent + 回环 SSH 测试通过：只向服务器提交指定公钥，指定公钥不存在时不换用其他密钥；指纹确认前 agent 公钥查询/签名和服务端认证计数均为零。密码和 AES 加密私钥成功建立 SSH 并执行测试服务的受控命令响应，错误口令无法建立登录。MemoryAgent 的 RSA SHA-256/SHA-512 协商签名也实际验证通过，没有修改签名算法。

首轮 agent 测试夹具把协议的 ParsedKey 当作 Buffer 使用，导致无应答；按本地 ssh2 类型/实现修正为 getPublicSSH。私钥准备函数的兼容路径可保留加密数据直到 SSH 客户端解析，因此错误口令断言改为实际登录拒绝，而非假定准备函数必须立即抛错。未修改私钥解析或放宽“错误口令不得登录”的条件。

最终协议组合 **2 文件 / 16 项通过**，日志 `agent-auth-protocol-recheck.log`。首次夹具失败保留在 `agent-auth-protocol-tests.log`。完整应用回归 **472 文件 / 3376 项通过，5 项条件跳过**，日志 `agent-auth-application.log`；条件跳过不计作已验证。

## 实际桌面认证证据

实际 Windows 桌面包通过，目录 `.cache/desktop-observation-report-3d23095b-b36a-4967-8670-53130cfa80c0`，日志 `agent-auth-desktop-first.log`，结果 `agent-auth-result.json`。使用独立命名管道服务和两个临时 RSA 身份，应用配置只指定第二个公钥。

- 指纹确认前 agent 公钥查询与签名均为 0。
- agent 认证后真实监控接口返回 50% 内存及 86400 秒运行时间；真实 SFTP 目录请求返回 `agent-ready.txt`。
- 实际终端页面建立 SSH shell 通道并接收测试标记，截图 `agent-terminal.png` 已查看。该夹具 shell 只提供连接标记，不把它描述为真实 Linux Shell 命令执行或完整自动/协作终端验收。
- 以上三种连接共 3 次公钥查询/3 次签名，全部使用指定公钥。
- 另一个使用 AES 加密私钥和正确口令的主机配置独立完成监控登录，agent 签名次数保持不变；服务端共验证 4 次签名。
- 应用正常退出，临时 agent 与 SSH 服务关闭；未连接系统 agent 或改变服务设置。

完整类型检查通过，全库 lint 为 0 错误/100 既有警告，静态中文键缺失 0。生产构建与 Windows 包通过，日志 `agent-auth-build.log`、`agent-auth-package.log`。包内原生依赖 13 项与 MCP 自动/协作/隔离 Codex 发现 3 项通过，日志 `agent-auth-native-probe.log` 和 `agent-auth-packaged-mcp.log`；Codex 只进行本机协议发现，无模型调用和日常配置修改。

上一提交 649f56a 的 CI 34399189478 已全部成功。本阶段没有新增通用共享模块、依赖或 MCP 工具；复用现有认证入口。全部隧道 agent 接线、其他 agent 产品、真实 Linux/OpenSSH/交互认证重试及完整原始验收继续。

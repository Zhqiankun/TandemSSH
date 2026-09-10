# 文件连接的共享交互认证

状态：共享人工认证队列和 SFTP 接线已实现，Windows 打包客户端验证通过。监控和跳板机尚未接入本协议，不能据此宣称整个 SSH 认证矩阵完成。

## 模块与契约

数据库、终端、文件和监控服务由 starter 在同一后端进程导入。已登录界面通过 30001 的 /ssh-interactive/requests、/respond、/cancel 获取和处理提示，无新增进程或外部服务。

- hosts/interactive-auth/service.ts 维护用户、连接、提示归属与权限复查，复用 KeyboardInteractiveExchange 的答案、轮数和时间限制。
- production.ts 适配 SSH Client 生命周期，检查用户数据密钥、当前主机访问权限以及地址、端口和用户名。http-routes.ts 负责人工用户鉴权、输入校验和协议错误；API Key/MCP 不得提交登录答案。
- hosts/file-manager/pending-connections.ts 只持有未完成的 SFTP 握手；成功后由既有文件会话管理器持有。其他用户不能替换或取消该连接，旧连接关闭不能移除新连接。
- SharedInteractiveMonitor 复用中文 KeyboardInteractiveDialog，显示用途、地址、端口、用户名；页面经 API 适配器访问公开接口，不依赖后端私有实现。

公开提示包含随机 ID、字段及 echo 属性、有效期和目标元数据。回复必须属于当前用户和当前提示，提交给 SSH 前再次检查权限，包括自动使用已保存密码的路径。答案保留原始空白和空字符串，不加入配置、日志或 AI 上下文。认证队列上限为全局 256、每用户 32；内核最多 32 轮，单轮 180 秒，总计 300 秒。

SFTP 通过 keyboardInteractiveVersion:1 协商新路径。原 connect 请求等待认证结果，问题经共享队列显示。取消、请求断开、连接替换或超时会关闭本次未完成的连接。回复后服务端仍在等待时保留取消入口；当前尝试的旧提示 ID 可以取消该尝试，已经结束的尝试 ID 不能影响新连接。认证错误使用非 401 状态，避免误退出应用登录。未声明能力和 Warpgate 调用保留原有协议，不宣称具备新提示隔离。

## 验收结果（2026-09-10）

- 新增 16 项专项测试通过：用户/API Key/数据密钥边界、访问撤销、自动填充前授权、并发取消、回复后等待、重复/旧 ID、待连接替换，以及中文弹窗和人工重连。
- 应用回归 490 个文件通过、1 个文件跳过；3490 项通过、12 项跳过。命令为 vitest run --exclude src/backend/tests/collaboration/pty-integration.test.ts --maxWorkers=2。该结果不包含独立 PTY 集成门禁，不用于宣称本机 ConPTY 问题解决。
- 类型检查、构建和 Windows 目录打包通过；lint 为 0 错误、100 项既有警告。字面量中文翻译键缺失为 0。
- 打包后的 13 项原生依赖探测通过；打包 MCP 的 3 项测试通过，隔离 Codex 客户端可发现 38 个工具。未改日常 Codex 配置、未调用付费模型。

真实 Windows 客户端连接本机隔离 SSH/SFTP 服务，完成多字段、保留密码空白、空回复、错误验证码后新提示、取消关闭连接、6.5 秒内无自动重连、保留应用登录、人工重连、旧 ID 返回 404，以及回复后等待服务端时取消。认证后上传 8388621 字节、下载 8388625 字节，独立核对内容相同；传输期间关闭本地面板仍完成。仅本机目录选择框使用固定测试路径注入，其余认证、传输和界面路径使用实际实现。此场景不代表 Linux PAM 或远程生产服务器验证。

首轮实测发现取消后没有人工重连入口。修复 FileManager 错误视图条件和 useConnectionRetry 的停止重试状态后，重新完成取消、人工重连和文件读取；随后补测回复后服务端等待时取消。

本机证据（不随源码发布）：

- 最终结果与截图：.cache/desktop-observation-report-20f9c9ea-291d-40f5-80c4-87920b2d2bb8/file-auth-result.json，以及 file-auth-multiple.png、file-auth-cancelled.png、file-auth-waiting.png。
- 首轮失败：.cache/desktop-observation-report-33702107-e791-4ea1-8961-25eecac368d8；中间复测：.cache/desktop-observation-report-67e3812e-feb6-4e9d-8618-344113aca460。
- 专项、应用回归与打包 MCP 日志：.cache/file-auth-contract-tests-final.log、file-auth-regression.log、file-auth-package-mcp.log。
- 隐私检查：.cache/file-auth-privacy-check.json。扫描本次独立用户目录中 7 个配置、审计或日志文件，未找到测试密码的 UTF-8/UTF-16 明文；未解密数据库，不能代替完整敏感数据审计。

## 剩余工作

监控及跳板机需接入同一队列并验证其取消、重连、主机信任和权限撤销。共享提示界面当前使用桌面主后端，不声称支持任意混合远端 API 来源。公开 Release、历史数据升级、独立 PTY 验收和原需求其他未完成项仍继续推进。

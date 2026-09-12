# 关闭旧终端启动输入并取消 alpha.10

2026-09-12，在等待 alpha.10 云端门禁期间继续 A22 高级配置审查，发现 Terminal.tsx 的 connected 分支在 100 ms 后直接发送：environmentVariables 拼接的 export、startupSnippetId 对应片段内容、autoMosh 的 moshCommand。该路径没有使用已存在的 legacyRawInputEnabled 禁用策略，也没有通过受控任务执行。

Git 标签源码核对：已发布 alpha.9 和准备中的 alpha.10 都包含上述三个输入路径。仅因其他测试通过，不能宣称它们不存在此问题。

## 发布处置

alpha.10 的 Release 运行 34678529650 尚在 Validate source 时，通过固定目标的一次性仓库 Actions 任务取消。取消任务 34678803770 成功，原 Release 的最终状态 completed/cancelled 已由 GitHub API 确认。该次发布未进入构建安装包或公开发布步骤。

浏览器工具两次启动失败，当前连接器没有取消接口；使用仓库自身临时 GITHUB_TOKEN 取消固定运行，没有提取凭据。一次性工作流完成后从源码移除。v0.1.0-alpha.10 标签保留原提交不重写，修复版改为 alpha.11。

## 修复

删除 connected 分支的延迟自动输入代码。配置保留，检测到旧环境变量、启动片段或 Mosh 配置时记录中文说明，要求经流程审阅执行。普通人工输入、终端连接及受控流程入口不变；不自动把用户配置改写成新的流程。仅改终端编排，不新增共享层或权限接口。

## 真实桌面对照

隔离的 Windows 目录版客户端连接真实回环 SSH 测试端点；端点只记录、回显输入字节，不解释执行命令，不连接业务服务器。

- 旧本地 alpha.9 目录版：报告 `.cache/desktop-observation-report-5f4a16e7-6f35-4efb-a854-010f7466357b/startup-boundary-result.json`，配置启动参数后观察到 `startup-must-not-run` 输入；人工输入也到达。该旧目录版含前期本地改动，不冒充未经修改的公共安装程序；上述标签源码另已核对同一漏洞路径。
- 修复后 alpha.11 目录版：报告 `.cache/desktop-observation-report-ebb6e4f1-9fa7-409a-a052-fe05e614112b/startup-boundary-result.json`，同时配置环境变量、真实创建的启动片段和 Mosh 命令，连接后没有观察到自动启动测试字节，人工输入正常。`startup-boundary.png` 已查看。
- 两轮正常退出，观察器退出码 0，SSH 夹具关闭。首次旧版脚本因在主机列表刷新前打开终端而超时，调整等待后才完成复现，不计入通过。

ESLint、TypeScript、中文检查（缺失 0）、本地 build 和目录打包通过。尚须对 alpha.11 重新执行完整发布门禁，不复用 alpha.10 的绿灯，也尚未推送 alpha.11 标签。

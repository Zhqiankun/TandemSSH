# 可预览的配置备份与恢复

桌面设置的“用户资料 → 数据 → 配置备份与恢复”支持备份 SSH 主机基本信息、命令流程和界面偏好。导出先预览再下载；导入先预览再确认，采用追加方式，不覆盖已有主机。界面偏好默认不恢复，需要单独勾选。

后续已扩展外观与快捷键，格式 2 及实际验证见 [应用设置备份](55-application-settings-backup.md)。

这是 B01/B15/A22/A36/A37 中配置备份部分的实现，不能据此将 B15 或完整产品验收标记为完成。自动执行、人机协作、随时接管和 Codex MCP 的原始验收范围不变。

## 数据边界与使用方式

- 普通备份不携带 SSH 密钥、密码、API key、MCP 配对、活动任务授权或指纹信任，不修改命令规则。排除有类型的凭据字段，并对已知秘密模式脱敏或排除；任意正文仍需用户核对预览。
- 导入主机标记为“待配置凭据”，需要重新选择认证方式与配置凭据。源数据中的数字 ID 不会绑定本机已有凭据，文件夹凭据也不能自动替代该步骤。终端和 SFTP 连接入口保留明确的重新配置提示。
- 导入流程保存为待绑定状态；必须明确选择具体目标主机并保存后才能使用。配置导入和保存绑定本身不执行流程。
- 导入不会启用监控、自动连接、启动命令、隧道、代理或跳板。隧道/跳板配置、AI 配置及完整凭据迁移尚未纳入；主题与快捷键的后续实现见文档 55。
- 预览显示规范化后的完整 JSON、主机和流程数量以及被忽略的字段；最大 8 MB，5 分钟后过期。预览后相关本机配置变化时，必须重新预览。
- 同一个确认请求使用持久化收据避免重复创建；主机、流程、可选偏好和收据在一个 SQLite 同步事务中写入，失败回滚。偏好恢复保留目标工作区的新手引导状态，需要用户自行重新加载界面。
- 桌面旧 SQLite 普通导入/导出入口返回配置备份入口提示；非桌面服务器的旧数据库迁移路径不在本次改造范围内。

## 模块责任

主智能体独立实施。`types/configuration-backup.ts` 定义公开文件和预览契约；`configuration-backup/schema.ts` 负责字段、容量、引用与秘密排除；`service.ts` 管理预览、过期、确认和幂等；`http-routes.ts` 负责已登录桌面用户校验及 HTTP 协议，不允许 API key 入口直接执行备份。

`configuration-backup-repository.ts` 是桌面恢复事务边界，只操作当前用户的主机、流程设置、界面偏好和导入收据。它明确拒绝非 SQLite 存储，使用现有用户数据加密、设置缓存和保存通知入口。生产适配通过流程库公开写锁与普通流程编辑协调。

界面和 API 适配位于 `ui/features/configuration-backup`、`ui/api/configuration-backup-api.ts`。依赖方向为界面 → API → 备份服务 → 仓库；业务规则不放入页面，没有新增通用共享抽象。`needsHostBinding` 与主机 `unconfigured` 状态分别由流程库和主机解析器执行约束。

## 实际验证（2026-09-10）

专项测试 6 个文件、52 项通过，包含真实 SQLite 回滚、持久化收据、加密源凭据导出排除、跨用户隔离、大小限制、显式确认、主机凭据与流程重新绑定、中文界面。日志：`.cache/configuration-backup-targeted.log`。复现命令在 `app` 下执行：

```text
npx vitest run src/backend/tests/configuration-backup src/backend/tests/database/repositories/configuration-backup-repository.test.ts src/backend/tests/collaboration/workflow-library.test.ts src/backend/tests/hosts/host-resolver.test.ts src/ui/tests/features/ConfigurationBackupPanel.test.tsx
```

真实 Windows 桌面最终验证目录：

- 首次启动：`.cache/desktop-observation-report-618e25e0-9e8c-45e3-9ce8-68497dfa57e8`。
- 同一数据目录重启：`.cache/desktop-observation-report-618e25e0-9e8c-45e3-9ce8-68497dfa57e8-restart`。

实际点击中文按钮完成导出预览、确认下载、文件选择、导入预览和确认；下载字节与预览一致。导入后无任务、无连接；主机凭据未配置，流程要求绑定。终端显示中文凭据提示；SFTP 在连接前拒绝；旧桌面 SQLite 导出被阻止。两次正常退出并释放服务端口，重启后主机、流程和偏好保留。

随后通过实际应用 API 显式保存新测试凭据与流程主机绑定，保存动作没有建立连接。再显式请求连接、在桌面对话框信任临时服务器指纹，真实 SFTP 返回 `backup-ready.txt`，连接正常关闭。只有这一次主动连接，没有执行远端命令。该正向补配验证覆盖后端 API 和桌面信任确认，未宣称已验证主机编辑表单的全部交互。

首轮桌面验证曾发现 SFTP 吞掉 `HOST_CREDENTIAL_REBIND_REQUIRED`，错误变成普通“缺少密码或私钥”；已在 SFTP 与终端边界修复，并在上述实际桌面重测通过。

类型检查、前后端构建及 Windows 目录打包通过；代码规范检查 0 错误、100 条已有警告；翻译字面量缺失 0。打包后的 MCP stdio/Codex 初始化与文件传输测试 3 项通过，工具清单保持 38 项；没有发起模型请求或修改日常 Codex 配置。实际 Electron 原生依赖探测 13 项通过。

对应日志：`.cache/configuration-backup-types.log`、`configuration-backup-lint.log`、`configuration-backup-build.log`、`configuration-backup-package.log`、`configuration-backup-packaged-mcp.log`、`configuration-backup-native-probe.log`，后五个也位于 `.cache`。

## 全量回归的失败记录与剩余范围

第一次全量运行：477 个文件中 476 个通过，3,408 项通过、1 项失败、4 项跳过。`pty-integration.test.ts` 的自动模式参数与目录场景期望 `completed`，实际 `paused-human`。不改断言的独立 PTY 复测 10 项通过；之后的全量运行中该场景也通过，但不能因此宣称间歇暂停原因已修复。已增加测试控制权变化诊断，日志为 `.cache/configuration-backup-application.log`、`configuration-backup-pty-isolated.log`。

第二次全量运行：3,410 项通过、1 项失败、4 项跳过；失败为 `scripts/download-batch-controller.test.ts` 的批次保存与恢复场景超出原有 5 秒时限。该文件独立复测 7 项通过，仍使用原有时限。日志 `.cache/configuration-backup-application-final.log`、`configuration-backup-download-isolated.log`。没有用重试通过覆盖先前失败记录。

完整测试集以 `npx vitest run --maxWorkers=2` 复测：477 个文件全部通过，3,411 项通过、4 项跳过；真实 PTY 自动与协作测试包含在内，原断言与时限均未修改，用时 292.33 秒。日志 `.cache/configuration-backup-application-bounded.log`。这证明了本轮较低并发条件下的完整回归通过，不等于修复了默认并发的间歇失败原因。尚未纳入格式的配置迁移、真实 Linux 环境与完整认证组合、默认并发下的上述间歇失败以及原始完整产品清单仍需继续验证。

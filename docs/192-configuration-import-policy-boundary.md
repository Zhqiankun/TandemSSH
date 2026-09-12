# 配置恢复：规则与启动字段不生效验证

2026-09-12，继续原始 A22 的恶意流程/连接/规则导入边界。统一配置备份仅支持明确列出的数据字段，不支持导入策略；未知规则字段会被剔除并产生 IGNORED_FIELD 预览警告，不能把此行为描述为已经支持规则文件导入功能。

## 实际链路

新增测试将真实 ConfigurationBackupService 的预览和恢复接到 ConfigurationBackupRepository、测试 SQLite。预先存入实际键 `tandem-policy:owner`，内容包含严格允许名单模式及 rm 黑名单。导入数据夹带顶层 policy/rules/runAfterImport、主机 terminalConfig.autoExecute/enableTunnel/autoConnect/policy。

结果：

- 预览的配置指纹不变，未新增配置，并产生 policy 忽略警告。
- 明确调用恢复后，原策略 JSON 逐字节保持一致。
- 新主机 auth_type 为 unconfigured、credential_id 为空、enable_tunnel 为 0。
- 持久化 terminal_config 及恢复后快照不包含注入的启动命令。

生产边界不变：schema 投影受支持字段，service 管理预览所有者和恢复确认，repository 持久化配置；本轮仅新增测试，无共享抽象或生产依赖变化。

## 验证结果

configuration-backup-repository.test.ts 与 schema-service.test.ts 共 30 项通过，针对性 ESLint、TypeScript 通过。测试使用真实 SQLite，但密钥访问由既有夹具提供固定测试密钥，审计适配为空实现；不声称真实 SSH 桌面或完整审计验证。

## 剩余范围

A22 保持 not-fully-verified。流程导入见 191；统一配置恢复中的策略和启动字段边界本轮已覆盖，但数据库仍有 `/database/import` 等旧入口，需核对其可达性和行为，再归并连接导入结论。没有把统一恢复入口的通过泛化到所有连接导入器。

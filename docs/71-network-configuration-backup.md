# 网络配置备份与恢复

状态：已实现网络配置备份 v3，专项、最终全量回归、Windows 导出/导入/重启和打包检查通过。

补齐 B15/F14 的主机跳板链、主机 local/remote/dynamic 隧道和 C2S 预设。备份格式升为 3，继续读取版本 1/2，旧格式中的新增网络字段不激活。备份内使用 UUID 主机引用，恢复时在同一 SQLite 事务中先创建无凭据主机，再映射引用写入网络配置和 C2S 预设；不得复用旧数据库数字 ID。主机隧道开关关闭，所有 autoStart=false，C2S 设备归属不继承到另一台机器。用户仍需重新配置凭据并手工启用/连接。

configuration-backup/network.ts 拥有网络格式校验、导出白名单、引用与跳板循环检查以及恢复映射，不访问数据库。schema.ts 负责版本和完整备份校验；repository 负责持久化、指纹及事务；service/UI 只显示数量、规范化内容和中文警告。指纹纳入跳板、隧道与预设，预览后被修改必须重新预览。主机端点用新数字 ID 保存，前后端解析器先匹配 ID，再兼容旧名称/地址，防止数字名称碰撞。

不导出密码、密钥、源/端点用户身份或活动授权。失去来源的导出配置明确警告并排除；导入中的缺失引用、自引用、环或过深跳板链拒绝。预设追加且名称冲突重命名，不覆盖现有预设；重复确认沿用既有持久化收据。事务失败回滚主机、网络配置和预设。

验收覆盖三种转发模式、引用重映射、重名数字端点、自动启动禁用、秘密字段排除、旧格式兼容、缺失/循环引用、跨用户隔离、预览后网络改动、回滚和幂等，以及实际中文桌面预览/导入/重启数据保留。

## 已执行验证

备份/数据库/中文面板/隧道专项 8 文件、76 项通过，包含旧格式未知字段继续忽略而 v3 严格解析、三种隧道模式、三种预设模式、直接目标、引用重映射、环和深度、重名 ID 优先、秘密排除、C2S 配置变更使预览失效、写入失败回滚与重复确认。首轮只有旧测试仍断言当前格式为 2 而失败，已随明确的版本升级改为 3，保留版本 1/2 的兼容场景。

真实 Windows 首轮证据 deed4ef4-0200-49f3-a82a-7e00613793fe：中文界面显示 1 个跳板引用、6 条隧道、1 个 C2S 预设；实际下载内容与预览一致；导入创建新主机 ID、跳板和端点重新映射；重名预设追加 (2)，三种模式均保留且 autoStart=false。随后正常退出并在同一隔离目录重启，引用和预设仍在，凭据仍未配置。两次启动的测试 SSH 服务连接计数和命令计数均为 0。这是配置迁移及“不自动执行”的验证，不替代三种模式真实转发验收。

查看首轮截图发现 SECRETS_AND_STARTUP_EXCLUDED 旧文案仍说排除跳板/隧道；已修正说明，明确保留网络配置、关闭自动启动、同名预设追加编号。最终画面与结果见下节。首轮功能结果保留，不将旧画面称为最终文案验收。

日志：.cache/network-backup-tests.log、network-backup-types.log、network-backup-lint.log、network-backup-desktop.log。当前剩余备份范围包括连接默认值、自定义终端主题库与本机活动 C2S 配置；C2S 保存预设已纳入本轮。凭据迁移、SOCKS 代理与自动启用不属于此无凭据备份格式。

## 最终交付验证

最终全量回归 502 个测试文件通过、1 个跳过，3568 项通过、12 项跳过，268.78 秒。命令 vitest run --exclude src/backend/tests/collaboration/pty-integration.test.ts --maxWorkers=2；独立 ConPTY 门禁仍在 CI 单独运行。本轮保留首轮全量 3567 项的日志，并在旧格式兼容修正后重新跑全量。最终类型检查、构建、lint（0 错误/既有 100 警告）、中文词条检查（缺失 0）通过。

最终桌面证据 .cache/desktop-observation-report-24f1ae05-0497-44b2-bc39-4c3962f575a9/network-backup-result.json 和同名 -restart 目录中的 network-backup-restart-result.json。新版预览说明及同名预设编号提示已通过文字断言和截图检查；网络配置、新引用、三种模式、默认禁用和重启保留再次通过。两次启动都正常退出，测试 SSH 连接和命令尝试均为 0。

最终 Windows 包包含四份项目/底座声明并通过逐字节校验，13 项原生依赖探测通过，3 项打包 MCP 测试通过，隔离 Codex 发现 38 个工具。未调用付费模型，未修改日常 Codex 配置。两轮隔离用户目录各检查 9 个配置、日志、数据库等文件，未发现测试密码明文，未解密数据库；下载备份也由验收脚本检查不含测试密码。应用端口已释放。

主要证据日志：.cache/network-backup-regression-final.log、network-backup-types.log、network-backup-lint.log、network-backup-localization.log、network-backup-desktop-final.log、network-backup-native-probe.log、network-backup-package-mcp.log、network-backup-privacy-check.json。

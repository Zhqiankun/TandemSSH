# 桌面旧主机导入：不继承激活状态

2026-09-12。host-bulk-routes 的旧 JSON 导入会直接保存 statsConfig，未提供时为 null；metrics/index 的 parseStatsConfig 对空配置使用默认配置。因此仅增加导入确认，不能证明导入配置不会进入后台采样流程。

## 变更与责任

新增 database/routes/host-import-activation.ts，归属主机导入模块，公开 inactiveImportedHost(record) 只处理即将持久化的主机记录。该纯函数不访问网络、凭据存储、数据库或 UI；调用方为 host-bulk-routes 的 JSON、SSH 配置导入，均在新增/覆盖写入之前应用。桌面边界由既有 runtimePolicy 决定；非桌面行为不变。

桌面导入后：

- metricsEnabled/statusCheckEnabled 为 false，disableTcpPing 为 true；采样间隔等其他设置保留。
- enableTunnel/enableDocker/enableProxmox/enableTmuxMonitor 为 false；隧道定义保留、autoStart 置 false。
- 专用于后台自启动的 autostartPassword/autostartKey/autostartKeyPassword 显式清空，避免覆盖时继承旧激活凭据。
- 用户确认导入的普通连接凭据、端口、终端显示配置保留；未声称已审查 terminalConfig 中全部潜在执行语义。
- 畸形 statsConfig 或 tunnelConnections 在写入前明确失败，不回退为启用状态。

中文/英文确认摘要说明导入后停用后台采样和自动启动；导入结果改为本地化新增、更新、跳过、失败计数，有失败项时用警告提示。

## 验证

host-import-activation.test.ts 与 host-bulk-routes.test.ts 共 14 项通过。覆盖保留普通连接和显示定义、清除自启动凭据、显式停用默认值、保持原输入不变以及畸形激活数据拒绝。后者原测试为 SSH 配置解析，不能视为真实批量 HTTP 路由执行。ESLint、TypeScript、中文检查通过（缺失 0）。

## 剩余验证

A22 不标为完成。仍需真实导入路由/数据库的新增和覆盖验证、桌面取消/确认验收及高级配置执行消费者核对。覆盖导入停用的是保存配置，不代表会中断已经运行的隧道或采样任务；运行中资源生命周期需另查。公共 alpha.9 尚不包含此修复。

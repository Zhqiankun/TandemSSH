# C2S 备份主机身份校验

2026-09-14。继续调查本地 C2S 迁移时发现并修复现有预设备份的身份映射缺口。

## 已确认的实际存储边界

本地 C2S 当前列表在 Electron userData/c2s-tunnels.json，由 get-c2s-tunnel-config/save-c2s-tunnel-config IPC 读取和保存，不属于 SQLite 的 C2S 预设表。界面 normalizeClientTunnel 保留 relayOrigin 和 sourceIdentity；执行前 C2sSession 要求经过本地来源和主机身份审阅。不能把该文件简单按数字 sourceHostId 合并进预设备份。

## 已修复问题

projectNetwork 处理现有 C2S 预设时只按 sourceHostId 查找导出主机，忽略配置中已保存的 sourceIdentity。若编号复用或配置来自不同实例，相同编号可能对应不同地址、端口或用户名。

新增6项回归用例：旧代码5项失败（IP/端口/用户不一致、null身份、无效字符串身份）；匹配身份场景通过。修复后对带有身份/来源字段的C2S配置要求 relayOrigin=local，并核对保存的IP、端口、用户名与实际导出主机一致。不一致则排除该条隧道并给出已有 NETWORK_REFERENCE_EXCLUDED 警告，不输出身份字段值到提示。无这些字段的旧数据库预设仍按既有导出方式兼容；恢复后继续保持禁用并要求审阅。

## 文件与验证

仅修改 configuration-backup/network.ts 现有投影职责及对应 network.test.ts，无新共享模块、无依赖方向变化。
完整备份回归7文件112项通过，无跳过，日志 .cache/backup-c2s-identity-tests.log。该修复有直接失败到通过证据，不将文件引用调查等同于本地C2S完整迁移交付。

## 后续必须完成

本地当前列表尚未接入导出和恢复。需要处理：
- Electron文件快照与数据库主机引用的一致性，校验保存的源身份；
- 恢复使用目标新主机编号与身份，不继承源审阅/会话状态，不自动监听；
- 数据库提交后本地文件独立写入的失败重试和重复确认，不覆盖后来人工修改；
- 实际界面导入、冷启动及无监听的验证。

本轮没有完成这些剩余项，也没有把当前列表改称数据库预设来缩小目标。F14/B15/A37保持未完整验收，整体69/79；未推送、未发布。当前目录包仍为462使用的版本，尚无本次投影修复。

最终 tsc -b 与修改文件 ESLint 均通过。

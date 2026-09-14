# 日志维护与脱敏导出的 Windows 验收

2026-09-14。当前470代码生成的本地Windows目录包，独立用户配置下进行真实文件与界面验证。

## 操作与磁盘核对

通过实际 /tandem/history/storage 获取当前用户目录。写入测试文件前验证路径位于本轮独立profile、父目录为tandem-audit且用户目录为预期散列形状，创建后再次realpath核对。仅创建本轮过期生成分片、新生成分片和普通fixture-notes.txt；不操作日常日志。

打开中文“操作历史”，核对界面只读路径与真实目录一致、留存7天/100MiB和文件数正确。点击“按留存规则清理”后取消，过期文件仍存在。

通过“导出全部保留记录”触发真实Electron下载，读回NDJSON，确认含record且末尾summary完整，原始测试password值不在导出文件中。随后再次发起清理并确认，真实磁盘只删除一条过期分片；新分片和普通文件保留，文件数减少1。界面显示“已清理1个日志文件”，历史仍可查询。

## 证据

.cache/desktop-observation-report-6d11e82c-1966-4534-a9e6-024fe535e38f/audit-cleanup-result.json 已逐项读取：
目录、留存、取消、只清过期、新日志/普通文件保留、统计更新、真实下载、再次脱敏、完整导出全部通过。

同目录audit-cleanup-completed.png已实际查看：目录、100MiB/7天规则、清理结果、导出生成结果和仍存在的历史记录可见。任务与会话为空，应用cleanExit，执行器退出0并释放业务端口。

脚本.cache/audit-maintenance-observer.cjs、run-audit-maintenance-native.cjs；日志.cache/audit-maintenance-native.log、audit-maintenance-package.log。测试密码是专用虚构值，不涉及日常密钥或服务器。

## 范围

本轮原生验证按时间过期清理；超量按容量清理、目录重定向拒绝、写队列串行行为由470的文件测试覆盖。不称所有故障都在桌面中复现。已有保留期外日志按规则不导出；测试确认导出是完整传输，不声称能恢复已删除事件。

F14/B15的日志位置、规则清理和脱敏导出已有当前实现及直接证据，接下来统一审计其设置与备份原始范围。整体70/79不变。当前本地目录包包含470；没有推送或公开发布。

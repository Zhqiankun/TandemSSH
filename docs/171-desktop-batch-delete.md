# 三文件批次部分失败与仅继续剩余项目

2026-09-12。在 Windows 桌面连接隔离 Linux SSH，用真实 Ctrl 多选和右键删除验证：第一项成功、第二项因权限失败、第三项尚未执行；显式提权后只继续剩余项。

## 实测发现与修复

测试目录为 root 所有的 sticky 目录，第一、第三文件属于 alpine，中间文件属于 root。因此普通删除第一项成功，中间项返回 Operation not permitted（EPERM）。

最初两次桌面运行未出现 sudo 对话框。第二次保存的选择状态证明三项均选中，HTTP 记录证明第一项已成功、第二项失败且第三项没有提交；进程日志明确报 Operation not permitted。原因是 operation-routes.ts 只识别 Permission denied。补充对 EPERM 文本的识别，仍要求明确非零退出码，未修改授权或自动重试规则。新增分片 EPERM 路由测试，与既有单次结果结算一起共 23 项通过；ESLint、后端 TypeScript 构建通过。

## 最终真实桌面结果

报告：.cache/desktop-observation-report-8bd601a1-632f-4558-8169-c8b22acaf49e。
batch-delete-partial-sudo.png 已实际查看，可见中文“已确认 1 项……其余 2 项……”和 sudo 密码对话框。

在提交密码前，独立 SFTP 确认第一项消失，中间文件仍为 protected、第三文件仍为 last。只捕获 deleteItem 请求的路径和 permanent 标志，不记录密码或认证头。

永久删除请求计数：
- 01-first.txt：提权前 1 次，最终仍为 1 次。
- 02-protected.txt：提权前 1 次失败，最终 2 次（用户确认密码后重试）。
- 03-last.txt：提权前 0 次，最终 1 次。

最终三项均消失，第一项未重放，桌面正常退出。初次尝试移入回收站的请求另行记录为 permanent=false，不混入上述永久删除计数。batch-delete-desktop-result.json 保存实际断言与请求序列。

## 边界

实例 9aec82c9-9398-409e-900d-1780223707f2 保持网络隔离，sudo 使用官方 APK 离线准备，临时权限与测试目录由夹具恢复/清理。失败报告 be24e242-2998-4071-8999-6f7873650fe4 和 b52f3be4-252f-418e-8ecc-83c4bc92faad 保留，不计通过。

本轮新增生产行为仅为文件操作路由识别已观察到的 EPERM；没有新增模块、共享抽象或依赖。B09 的该批量部分失败场景已实测，执行中断线/切换及重连后的完整交互仍需验收。公开 alpha.8 不包含本轮后续修复。
专属实例经 QMP 关闭，启动器退出 0；git diff --check 通过。

# 下载启动失败后重新检查冲突预览

2026-09-14，继续B07/F09。DownloadTreeDialog启动失败后原来仅清除busy，旧choices及ready可能再次允许开始；上传侧已将这种情况标为dirty，下载侧缺少对应保护。

下载启动失败且对话框仍存在时，现在设置dirty并记录failedStart，禁用旧确认。重新检查成功后清除failedStart/dirty，并由既有preview重置所有冲突决策。新增中文提示区分“本次启动未完成，需要重新检查”和“目标名称已修改”，不将启动失败说成用户改名。

模块仍为下载预览UI编排，批次服务、原生目标及文件写入契约未修改；没有新增共享抽象。当前错误不自动重试，也不默认保留覆盖授权。

新增测试模拟批次启动因目标变化失败，修改前失败；修复后实际中文提示出现、确认禁用、重查后目录决策为空、不会再次自动启动。上传下载预览共2文件14项通过，TypeScript、ESLint和翻译键检查通过。日志 .cache/download-approval-before.log、download-approval-after.log、download-approval-tsc.log、download-approval-lint.log、download-approval-locales.log。

尚未重建目录包执行真实目标变化后失败/重查矩阵。B07未完成，整体47/79，未推送或发布。

# 双向目录冲突策略授权边界

2026-09-14，继续B07/F09。当前实现将文件覆盖、目录合并与跳过分开，本轮没有修改生产策略，补充直接组件验证。

上传与下载各新增两项：只点击“本批覆盖已有文件”时，父目录处理仍未选择、确认开始按钮禁用，批次未启动；先选择覆盖已有文件、再逐项跳过父目录后，提交的父目录、已有子文件和新子文件均为skip，子项不能凭先前覆盖选择绕过父目录跳过。

使用真实UploadTreeDialog/DownloadTreeDialog、中文控件和提交决策；远端预览及批次端口受控，不执行真实磁盘写入。与原有明确合并/覆盖、改名重新检查并清空旧选择等用例共2文件13项通过。TypeScript、ESLint退出0。日志 .cache/tree-conflict-boundaries-tests.log、tree-conflict-boundaries-tsc.log、tree-conflict-boundaries-lint.log。

此证据说明授权组合行为，不替代同名覆盖/改名落盘的完整桌面验证。B07仍未完成，整体47/79，未推送或发布。

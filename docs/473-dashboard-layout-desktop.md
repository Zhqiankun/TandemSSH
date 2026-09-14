# 自定义仪表盘布局的 Windows 恢复验收

2026-09-14。补齐472实际布局迁移的直接桌面证据。

## 测试配置

源布局有三项：quick_actions在main列首项、高180；counters_bar在main列第二项、高60；stats_bar在side列首项、保存高度250（渲染沿用460按内容撑高逻辑）。mainWidthPct=55、dashboardView=dashboard。目标改为无卡片、75%宽度、homepage默认页，使恢复差异明确。

通过实际中文备份页面导出预览并下载，检查desktopLayout是源卡片结构和宽度，下载与预览一致。选择下载文件、明确勾选恢复偏好，确认后手动重新加载。读取实际本地配置并测量卡片矩形，确认快捷操作在左、概览在右且顶部对齐。目标homepage被恢复为dashboard。

随后正常关闭应用，以同一配置冷启动，布局、宽度和默认页继续保持。沿用的外观与快捷键流程同时验证Nord、大字号、强调色、侧栏可见性以及导入快捷键禁用、单项编辑后只启用该项。

## 原始证据

.cache/desktop-observation-report-3caed587-2ea8-4955-8dd0-d1aa19fa1e5c/application-settings-result.json 与同前缀加 -restart/settings-restart-result.json 已直接读取，布局捕获、可见恢复、宽度保留和无自动执行均通过。

-restart/custom-layout-visible.png 已实际查看：左列快捷操作及计数卡片，右列概览，55%宽度下内容完整。不是只比较JSON或者恢复预设名称。两次应用cleanExit、执行器退出0并释放业务端口；任务与会话为空。

脚本.cache/dashboard-layout-backup-observer.cjs、run-dashboard-layout-backup.cjs；日志.cache/dashboard-layout-native.log、dashboard-layout-native-package.log。

## 范围

实际验证上述非默认卡片排列与宽度、从homepage恢复dashboard。不是所有排列/尺寸/默认页组合的穷举。147项自动化回归另由472覆盖输入边界、默认值、旧备份和回滚。F14/B15仍需在统一设置覆盖审计后关闭，整体70/79。

当前本地目录包包含472及470。没有推送Git、触发Actions或更新公开安装包。

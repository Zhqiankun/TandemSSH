# 最近活动类型与相对时间汉化

2026-09-13，F01/B01 局部完善。

检查发现自定义 RecentActivityWidget 直接显示 file manager 等类型及 m ago/h ago/d ago，默认仪表盘也使用 m/h/d 时间缩写。两处改为使用当前 i18n 语言的 Intl.RelativeTimeFormat；小组件的活动类型复用已有 networkGraph 中文标签，协议缩写 RDP/VNC/Telnet 保留。

新增 features/homepage/recent-activity-time.ts，只归最近活动的展示领域所有；公开 formatRecentActivityTime(timestamp, language, justNow, now) 是纯格式化入口，调用方为默认 DashboardTab 与自定义 RecentActivityWidget。它不读取 API、不设置定时器、不依赖页面实现，独立测试分钟/小时/天、未来时间、非法日期及 en_US 兼容。新增这一模块是为两个同语义的实际展示入口统一行为，不放入通用 utils。

刚刚/未来时间沿用既有 dashboard.justNow 翻译；非法日期返回“—”，不会假称刚刚或显示 NaN。真实组件测试验证中文主机名、文件管理类型和 5分钟前。

3 文件 10 项测试通过，TypeScript 与翻译键检查通过（缺失 0）。ESLint 0 错误、RecentActivityWidget 原有 Effect 依赖警告 2 项，未在此次汉化中混入异步轮询重构。首轮因为重复导出组件而编译失败，保留原有文件尾导出后通过。

日志 .cache/recent-activity-localized.log / recent-activity-tsc.log / recent-activity-lint.log / recent-activity-locales.log。尚未打包本轮汉化或进行最近连接/导出整体实机验收，38/79 计数不变。未提交、推送、打标签或触发 Actions。

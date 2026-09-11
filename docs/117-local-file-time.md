# 本地文件时间与应用语言

2026-09-12，B04 文件浏览核对发现本地面板使用无 locale 的 toLocaleString，随系统默认语言显示，与已汉化的远端面板可能不一致。

LocalFilePanel 复用同一文件领域 createFileModifiedFormatter，按应用 resolvedLanguage/language 创建一次 formatter。本地 modifiedAt 是毫秒，调用处显式除以 1000 转为格式器的秒输入。没有改变底层时间戳、排序或文件版本。无效日期回退为 —，不会显示 Invalid Date。未新增通用共享模块或反向依赖。

新增实际本地面板测试通过：中文年/月/日，切换英文后月/日/年；畸形时间回退；已有导航、目录选择、搜索并发、上传选择、Windows 属性回归保持通过。联合远端修改时间测试共 2 文件 / 10 项通过。

本轮未启动桌面应用或连接业务服务器，不能据此宣称全部 B04 浏览场景已完成。公开 alpha.5 不含此显示修复。
修改文件 ESLint 与 tsc -b 类型检查通过。

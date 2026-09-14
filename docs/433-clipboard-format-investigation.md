# 系统剪贴板格式只读复核

2026-09-14，继续F03/B03。当前隔离客户端只调用Electron clipboard.availableFormats，得到text/plain和text/html；在任何readText/readHTML或写入之前主动终止。报告.cache/desktop-observation-report-ae266a0e-2e5c-4c03-bc89-c678a2d86dec，日志.cache/clipboard-format.log。退出错误是只读探针的主动中止标志，不是复制粘贴测试通过。

与423相比，现在已明确阻止纯文本恢复方案的格式是HTML，不能仅恢复纯文本而丢弃富文本数据。计划采用原始格式字节在内存中保存和恢复，保护用户期间的新复制内容；辅助脚本准备时PowerShell嵌套here-string解析失败，未创建或启动修改流程。检查未发现raw-clipboard-harness.ps1、raw-clipboard-restore.json或run-raw-clipboard.cjs。

原样恢复实现仍需先验证资源所有权、部分失败、未知格式和用户期间更换剪贴板内容的处理。不能在未经验证的恢复机制下操作当前剪贴板，不能将本次格式信息当作系统剪贴板端到端证据。

本轮无生产代码变更，无剪贴板内容读取/写入。整体67/79，F03/B03继续未完成。未推送Git或触发Actions。

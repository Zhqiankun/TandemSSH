# 命令历史断线后的真实界面验收

2026-09-14，承接454，使用当前目录包验证原会话失效后的历史窗口。

报告.cache/desktop-observation-report-de41c462-8486-496f-a25e-b250486130c9/history-offline-result.json已读取。先从已连接工具栏打开并选择历史，随后关闭受控SSH连接，等待后端旧会话不再connected。窗口显示中文“原会话不可用或已变化”，追加按钮禁用，点击禁用按钮后SSH接收字节没有增加。

通过Escape关闭窗口后，从断线界面的命令历史按钮再次打开，保存的中文记录仍可读取和完整预览，追加仍禁用。截图history-offline.png保存在同目录。本轮不操作系统剪贴板。

客户端cleanExit=true、runner exit0，30001–30012无监听；日志.cache/history-offline-desktop.log，未出现固定测试认证秘密。脚本history-offline-observer.cjs、run-history-offline.cjs。

此结果覆盖真实SSH断线、旧对话框禁止追加及离线查看入口，不声称已经实测保持旧对话框时后台建立新会话的全部排列。没有新生产代码改动或重复打包。整体67/79，未推送Git、未触发Actions，公开安装包未更新。

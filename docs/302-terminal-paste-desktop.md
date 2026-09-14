# 多行粘贴 Windows 桌面验收

2026-09-13，承接 301。使用当前源码构建的 Windows 目录包和独立 ssh2 接收端，未上传公开安装包。

报告目录：`.cache/desktop-observation-report-a799e9e1-0022-46c2-aa65-779aed13380d`。`paste-native-result.json` 的全部断言通过：单行立即发送；多行预览确认前不发送；取消不发送；确认仅发送一次；CRLF/LF 经 xterm 正常转换后逻辑内容完整；断线后确认旧预览显示中文连接变化提示且 SSH 接收端没有旧内容。已人工查看 `paste-preview.png`，中文目标、完整只读内容和取消/确认按钮正常。

测试通过浏览器 ClipboardEvent 驱动真实桌面的 DOM、xterm 和实际 SSH 通道，并核对接收字节；没有读取或修改系统剪贴板。这不是 Windows 系统剪贴板端到端验证，也不是 Linux 命令执行证明。进程正常退出，日志检查没有测试认证秘密；独立测试服务器由 runner finally 关闭。

脚本：`.cache/run-paste-native.cjs`、`.cache/paste-native-observer.cjs`。日志：`.cache/paste-native-desktop.log`。目录包构建日志：`.cache/paste-native-build.log`、`.cache/paste-native-package.log`。

F03/B03 的多行粘贴子项已有实际 SSH 接收证据；完整终端工作区要求保持未完成，44/79 不变。未提交、推送或触发 Actions。

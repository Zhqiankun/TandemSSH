# 新会话历史隔离的 Windows 实测

2026-09-14，承接440。当前源码完整build与Windows目录打包exit0，包含会话缓冲绑定；日志.cache/history-reconnect-build.log、history-reconnect-package.log。

成功报告.cache/desktop-observation-report-6e8554b1-c40b-4b18-be9c-4f3f1fbee72e/history-reconnect-result.json已读取。旧会话89ec58c1-6553-40c2-a6d8-6c4fa5dc6612输入OLD_UNSUBMITTED_半行，真实SSH服务收到但未按回车，历史读取仍为空。断开真实SSH流，等待旧会话不再连接，点击可见“重新连接”按钮建立新会话ef84a884-c02f-4736-805b-72f7de068638。

在新会话原生输入echo 新会话并回车，历史恰为这一条，无旧前缀。history-native-result.json同时确认本轮前置中文/emoji原样保存、回车前不保存、删除保留另一条、清空后读取为空。

客户端cleanExit=true、父runner exit0、30001–30012无监听；日志.cache/history-reconnect-desktop.log。未出现固定测试认证秘密。

使用实际Windows界面重连与输入、受控ssh2 shell及实际历史HTTP接口；测试服务不执行真实Linux命令。此结果证明新后端会话缓冲隔离，不冒充同一存活会话跨进程重载时仍能恢复未提交输入，也不代替所有Shell/TUI行编辑、历史面板按钮和完整连接状态矩阵。

F03新增当前实机证据，整体仍67/79。未推送Git、未触发Actions，公开安装包未更新。

# 快捷键参数框真实 SSH 验收

2026-09-13，当前目录包包含 320–323 的连接保护、参数保留及失败反馈。本轮同时修正简繁中文参数框“跑步”误译为“执行/執行”，补全标题引号。

首轮原生报告 426a1a85-f4db-44d2-8e13-e99f34dc907e 的取消及正常执行已通过，但断线旧确认没有显示拒绝提示：实际 SSH 结束时 WebSocket 仍可保持 OPEN。仅检查 WebSocket 身份不足以判断 SSH 会话是否仍有效。

修复：KeybindingDispatchContext 增加调用方可选 isSessionCurrent；Terminal 在触发时捕获 sessionId，并要求 wasConnectedRef 为 true、当前会话 ID 相同。该校验与原 WebSocket 身份/OPEN 检查共同用于异步读取和参数发送回调，通用层不反向依赖 SSH 状态实现。新增会话结束但 WebSocket 保持 OPEN 的回归，3 文件 34 项通过。

成功重测报告 .cache/desktop-observation-report-a051f84f-663b-4a98-8eea-7b8f92bdb1de：专用 API 配置 F8 命令片段，真实 xterm 快捷键打开参数框，取消无 SSH 输入；填写“中文参数”，实际预览 echo 中文参数，点击执行后 SSH 接收端精确收到一次 echo 中文参数加回车；再次打开参数框并断开 SSH 后，点击旧执行显示中文拒绝提示，没有 STALE_NATIVE 字节。已查看 snippet-parameters.png。

桌面正常退出、日志不含固定认证秘密。脚本 .cache/run-snippet-native.cjs、snippet-native-observer.cjs；日志 snippet-native-desktop.log、snippet-native-tests.log、snippet-native-build.log、snippet-native-package.log。测试使用受控 shell，不声称真实 Linux 命令执行；未包含可选二次确认 toast 的完整实机重连矩阵。默认参数标签仍显示 Input 1，后续补齐中文。

F03/B03 未完成，整体 44/79，未推送或发布。

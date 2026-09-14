# 参数片段确认绑定原连接

2026-09-13，补齐 320 留下的参数框已打开后重连路径。

原 Terminal 参数框 onConfirm 以及可选 confirmWithToast 的 send 回调会读取当前 webSocketRef，可能把旧参数操作发到重连后的会话。dispatcher 现在通过 onSnippetNeedsInputs 的第二个参数提供一次性 sendResolved(text) 回调，闭包绑定触发时的 WebSocket。执行前核对身份与 OPEN 状态，同次回调先消费再发送，重复确认拒绝。

Terminal 的 pendingKeybindingSnippet 保存该发送能力；参数解析、可选二次确认完成后调用它，不再直接读取新 WebSocket 发送。拒绝时显示中文“连接已变化或本次确认已使用，未发送命令”，用户可重新触发片段。

边界：keybinding-dispatch 拥有目标绑定与一次性消费，Terminal 负责参数和确认 UI；不新增后端接口、不修改人工接管/命令策略。可选回调增加第二参数，已有单参数调用方可兼容。SSH transport.write 异常的含义未在此重新定义。

验证：新增确认阶段重连与重复发送 2 项，修改前均失败。修复后与既有片段、变量、读取重连及粘贴 hook 合计 2 文件 25 项通过。日志 .cache/snippet-confirm-before.log、snippet-confirm-after.log。尚未重新打包执行参数框和二次 toast 的实机重连矩阵，不据闭包测试宣称整个 UI 已验证。

整体 44/79，F03/B03 未完成，未推送或发布。

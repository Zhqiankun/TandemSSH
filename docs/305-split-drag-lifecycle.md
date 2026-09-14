# 分屏拖动取消与卸载清理

2026-09-13，继续 F03/B03 标签和分屏验收。

问题：SplitView 的鼠标/触摸分隔条只处理 mouseup/touchend，没有处理窗口失焦、touchcancel、组件卸载。旧 window 移动监听可能继续调用布局回调，模块级 splitDragState.active 也可能保持 true，导致终端继续抑制 fit。

边界与责任：useSplitDrag 是 SplitView 内部布局交互 hook，负责一次拖动的监听器生命周期；splitDragging 模块继续承载既有全局尺寸调整抑制标志和 fit 回调。本轮未新增共享抽象或修改 SSH 会话状态、输入路由、标签关闭语义。

改动：hook 持有当前拖动的清理引用。统一结束函数按引用核对所有权，先消费引用，再移除 blur/touchcancel 与该次移动/结束监听，复位拖动状态并通知终端 fit。卸载、失焦、触摸取消和正常结束均执行同一清理；启动下一次拖动前清理上次拖动。重复或迟到的结束事件不重复通知。

验收：新增横向/纵向鼠标拖动卸载、横向/纵向触摸取消、失焦通知一次等 5 项，修复前均失败（原有 7 项通过）。修复后再增加正常拖动 50/50 到 60/40、松开后不继续移动的回归；与 splitTabUtils、workspaceUtils 合计 3 文件 32 项通过。TypeScript 退出 0，ESLint 无错误，保留原有 react-refresh/only-export-components 警告 1 项。

证据：.cache/split-drag-before.log、split-drag-final.log、split-drag-tsc.log、split-drag-lint.log。代码为 app/src/ui/shell/SplitView.tsx，测试为 app/src/ui/tests/shell/SplitView.test.tsx。

本轮证据是组件 DOM 事件与真实共享拖动状态；未重新打包实机验证，也不据此声称多标签/分屏会话和输入隔离全部完成。F03/B03 保持未完成，整体 44/79。未推送或触发 Actions。

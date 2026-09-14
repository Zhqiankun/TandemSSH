# 终端搜索输入法与键盘事件边界

2026-09-13，继续 F03/B03 终端工作区。

问题：搜索输入框的 Enter、Escape 分支在 stopPropagation 之前返回，使搜索导航/关闭事件继续冒泡；输入法组合期间的 Enter/Escape 也被当成搜索操作并 preventDefault，影响中文候选确认或取消。

文件责任：`TerminalSearchBar.tsx` 负责搜索控件事件和展示。键盘事件在入口停止冒泡；nativeEvent.isComposing 或兼容 keyCode 229 时保留默认输入法行为，不触发查找或关闭。普通 Enter、Shift+Enter、Escape 保持原搜索行为；Ctrl+V 等仍保留浏览器默认行为。依赖方向不变，没有新增共享抽象、后端 API 或 SSH 写入路径。

验收：新增 `TerminalSearchBar.test.tsx`，修复前 6 项中 5 项失败，修复后与粘贴预览、粘贴 hook、自定义快捷键合计 4 文件 25 项全部通过。覆盖正反向搜索、关闭、输入法 Enter/Escape/229、剪贴板快捷键及父级事件隔离。日志 `.cache/search-keyboard-before.log`、`.cache/search-keyboard-after.log`。

本轮使用 DOM 事件回归验证，未证明 Windows 实际输入法候选窗口的完整行为，也未重新打包此次搜索修复。F03/B03 保持未完成，未推送 Git 或触发 Actions。

补充检查：TypeScript 构建检查、ESLint 均退出 0，日志为 .cache/search-keyboard-tsc.log、.cache/search-keyboard-lint.log。

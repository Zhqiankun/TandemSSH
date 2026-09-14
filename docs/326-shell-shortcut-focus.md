# 应用级快捷键的编辑焦点边界

2026-09-13，继续 F03/B03。AppShell 的命令面板、侧栏切换、标签/分屏快捷键入口原来没有统一的编辑焦点与 IME 判断。

新增 shell/shortcut-focus.ts，归属应用壳层，只负责判断本次键盘事件应否让出。输入法 isComposing/keyCode229、表单输入/文本框/select、可编辑区域及 dialog/alertdialog 内控件均让出；正常 xterm-helper-textarea 继续允许终端主动委托的全局导航。通过 composedPath 首元素判断真实事件目标。无 SSH、策略或页面反向依赖。

AppShell 三处处理入口使用相同规则；命令面板在让出事件时重置双 Shift 计时，避免编辑区按键串入全局双击序列。不使用 defaultPrevented 作为统一拒绝条件，因为 xterm 委托前会主动 preventDefault。

验证：表单、编辑元素、对话框、正常终端、终端 IME 和普通非编辑按钮；与搜索、参数框共 3 文件 22 项通过。日志 .cache/shell-shortcut-focus-tests.log。尚未重新打包验证真实桌面的所有组合键，不据局部测试宣布全局快捷键已全部完成。

整体仍 44/79，未推送或发布。

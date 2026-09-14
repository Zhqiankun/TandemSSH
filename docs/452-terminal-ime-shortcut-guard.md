# 输入法组合状态下的终端快捷键保护

2026-09-14，继续F03/B03中文输入与快捷键边界。

终端自定义键盘处理器原先只检查keydown类型，没有检查isComposing或旧浏览器keyCode229信号；快捷键匹配器也会命中这种事件。因此输入法处理中的键可能触发自定义动作或内置搜索/补全等应用行为。

在既有keybinding-match模块新增isImeCompositionKey，沿用项目shortcut-focus和片段参数输入框的两种组合状态判据。eventMatchesCombo先拒绝组合事件；Terminal自定义处理器在任何应用快捷键、Tab补全或菜单处理之前返回控制权给xterm/输入法。没有阻止正常的组合文本提交，也没有新增对人工普通命令的限制。

模块归属为键盘匹配层，Terminal依赖已有公开入口，不新增shared目录或反向业务依赖。后端、数据库和API不变。

新用例修复前2失败/8通过；修复后连同快捷键派发、焦点规则共44项通过。包括isComposing和keyCode229不命中自定义动作，以及普通快捷键和待审阅/禁用导入项的既有回归。日志.cache/terminal-ime-before.log、terminal-ime-after.log。

测试使用浏览器KeyboardEvent组合标记，不冒充真实Windows输入法候选窗口或所有IME厂商验收。该实机场景仍保留，整体67/79。未重打包本轮改动、未推送Git、未触发Actions，公开安装包未更新。
最终 `tsc -b` 与修改文件 ESLint 均exit0；日志 `.cache/terminal-ime-types.log`、`terminal-ime-lint.log`。

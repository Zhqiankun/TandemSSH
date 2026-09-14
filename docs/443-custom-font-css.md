# 自定义字体名称的 CSS 转义

2026-09-14，继续F03/B03字体范围。

resolveTerminalFontFamily原先把自定义名称直接插入双引号，名称中的引号、反斜杠或控制字符可能破坏CSS font-family列表，导致配置未按预期解析，不能依靠末尾monospace保证正常回退。

现在仅对自定义名称做CSS码点转义，保留名称语义及既有SF Mono/Consolas/Liberation Mono/monospace回退链；已知预设和空值路径保持不变。普通中文及逗号仍作为一个字体名称。改动留在既有终端主题/字体解析模块，无新共享抽象、API或数据库变更。

4项新用例修复前2失败/2通过；修复后连同字号模块共9项通过。覆盖引号/反斜杠、Unicode/逗号、控制字符、预设/空值与现有字号行为。日志.cache/font-family-before.log、font-family-after.log。

本轮为字体配置字符串修复，不声称实际已安装了该自定义字体，或完成原生字体回退/重启外观验收。字体缺失时的真实渲染回退和冷启动仍待下一步验证。整体67/79。

未重打包本轮改动、未推送Git、未触发Actions，公开安装包未更新。
最终 `tsc -b` 与修改文件 ESLint 均 exit0；日志 `.cache/font-family-types.log`、`font-family-lint.log`。

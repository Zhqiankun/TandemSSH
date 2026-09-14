# 浏览器组合输入与快捷键的当前包实测

2026-09-14，承接452。当前源码build与Windows目录包exit0，日志.cache/ime-browser-build.log、ime-browser-package.log。

成功报告.cache/desktop-observation-report-ff73187e-e527-42d1-a0af-c0071038f10e/ime-browser-result.json已读取。通过实际用户偏好API配置Enter快捷键，仅发送无回车测试标记到受控SSH接收端。首先普通Enter确实发送一次标记，证明快捷键已加载。

随后在真实Chromium输入框通过Input.imeSetComposition启动中文组合输入，发送带keyCode229的Enter键事件。SSH没有收到额外标记或尚未提交文本。取消组合输入后，再按普通Enter正常发送第二次标记。记录实际keydown字段供核对，未把整个键盘处理器禁用来获得通过。

客户端cleanExit=true、runner exit0，30001–30012无监听；日志.cache/ime-browser-desktop.log。未出现固定测试认证秘密。

范围：这是当前Windows客户端中的真实浏览器组合API、键盘事件和SSH字节验证，非操作系统Microsoft拼音或第三方IME候选窗口，不关闭该独立实机范围；也不声称真实Linux命令执行。整体67/79。

未推送Git、未触发Actions，公开安装包未更新。

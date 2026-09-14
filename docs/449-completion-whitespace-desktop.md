# 补全空格与控制字符的Windows实测

2026-09-14，承接448。当前源码build及Windows目录包exit0，日志.cache/completion-space-build.log、completion-space-package.log。

成功报告.cache/desktop-observation-report-7f190dce-494c-4999-8a40-b1e0311757be/completion-space-result.json已读取。实际Windows终端连接受控ssh2 shell，预置历史后通过原生输入、Tab、方向键、Enter和鼠标选择验证：

- 单候选：输入printf后引号中的尾部空格，补全后SSH接收恰为printf ' value'，未重复或删除该空格。
- 多候选鼠标选择：输入两个前导空格及共同前缀，选择后原前导空格和后缀完全保留。
- 多候选键盘选择：方向键改变实际高亮项，Enter只补全该项后缀，没有发送回车。
- 含换行候选：数据库中预置带换行的测试记录，不作为应用补全发送；没有合格候选时仅把用户按下的Tab交给Shell，没有发送后续DO_NOT_RUN文字。

每步均等待实际SSH接收字节达到预期完整值再继续，避免把异步输入误判为额外发送。各场景之间通过原生Ctrl+C清空当前输入，确认其字节到达。受控Shell不执行Linux命令，验收对象为输入传输及界面选择行为。

客户端cleanExit=true、runner exit0、30001–30012无监听，日志没有固定认证秘密。日志.cache/completion-space-desktop.log；脚本completion-space-observer.cjs、run-completion-space.cjs。准备焦点辅助脚本时一次PowerShell引用语法失败，改为独立脚本后才运行，未把失败准备当作产品问题。

本轮新增三条补全路径的实机证据，不代替全部快捷键、主机间补全切换或输入法候选窗口验收。整体67/79。未推送Git、未触发Actions，公开安装包未更新。

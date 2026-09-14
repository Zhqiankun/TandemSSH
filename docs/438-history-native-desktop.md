# 中文终端历史的当前 Windows 实测

2026-09-14，承接435–437。当前源码完整build及Windows目录打包exit0，包含历史输入校验、主机访问和Unicode跟踪修复；日志.cache/history-desktop-build.log、history-desktop-package.log。

成功报告.cache/desktop-observation-report-d94fc284-3b88-4af0-a28e-507870d05f22/history-native-result.json已读取。当前客户端实际连接受控ssh2 shell，经指纹确认、原生终端输入中文与emoji；回车之前历史为空，回车后实际历史API返回原样文本。再提交另一条中文命令，删除第一条后第二条保留，清空后再次读取为空。

客户端cleanExit=true，父runner exit0，业务端口30001–30012已释放。日志未出现固定测试密码/私钥标记；.cache/history-native.log。脚本history-native-observer.cjs、run-history-native.cjs。

本轮使用UTF-8；输入为实际Chromium终端输入与SSH传输，历史查询/删除/清空为实际HTTP接口，不是点击历史管理面板。受控shell不执行Linux命令，不能把按回车提交输入等同于命令成功执行。未作跨重启记录恢复或全部行编辑矩阵。

## 新发现待验证边界

Terminal.tsx在ws.send之前调用trackInput，后端TERMINAL_INPUT_NOT_REPRESENTABLE到达时目前仅显示错误。因此旧编码下被拒绝的输入是否仍留在历史缓冲中，需要进一步复现并修复；本轮UTF-8成功不能覆盖该情况。也不能据此声称历史面板、所有快捷键、输入法候选窗口或tmux旧编码已全部验收。

整体67/79；未推送Git、未触发Actions、公开安装包未更新。

# 四编码 Windows 桌面 SSH 验收

2026-09-13，当前源码完整 build 和 Windows 目录打包成功，包含 311–313 的终端编码、配置界面和写入前拒绝。

成功报告 `.cache/desktop-observation-report-8ddb4a5d-9cf7-4d1c-8eec-ab15eac99621`。四个独立主机使用专用 API 预置 terminalConfig.encoding，真实界面连接、指纹确认并建立 SSH shell。测试服务以每次一个字节、间隔 35 ms 写出字符样本，实际 DOM 断言完整显示；实际 Chromium Input.insertText 输入样本，SSH 服务收集原始十六进制字节并逐字节匹配所选编码。

- UTF-8：中文及 emoji。
- GB18030：中文及四字节 emoji。
- Big5：繁體中文。
- Shift_JIS：日本語。

Big5、Shift_JIS 额外输入无法表示的 emoji，断言中文“未发送”提示出现、SSH 接收字节未增加；随后输入 OK 成功，证明连接仍可继续使用。已查看 sjis-good.png，日文及中文错误提示正确。

四个 *-encoding.json 均通过；桌面正常退出并释放端口，测试服务及 runner 清理完成。日志未包含固定认证秘密。脚本 .cache/run-encoding-native.cjs、encoding-native-observer.cjs；日志 encoding-native-desktop.log、encoding-native-build.log、encoding-native-package.log。

证据限制：主机编码通过专用 API 配置，未将此报告当作选择控件保存点击的 UI 验收；TCP/SSH 可能重新组合服务端写块，每种编码的所有精确分包位置已由 311 的解码器测试覆盖。本轮是受控 ssh2 shell，不宣称运行真实 Linux 命令或完成 tmux 等全部附加输入路径的多编码验收。编码选择控件实机、其他写入路径和完整 F03/B03 仍有待办，整体保持 44/79。未推送或触发 Actions。

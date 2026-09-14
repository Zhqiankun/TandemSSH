# 多行粘贴预览与连接绑定

2026-09-13，F03/B03 新增原要求中的多行粘贴预览。

use-terminal-paste.ts 属于终端输入编排，捕获当前 WebSocket 身份及会话 ID；单行保持直接粘贴，包含 CR/LF（包括仅末尾换行）的内容先暂存。确认前再次核对当前连接，失效则显示中文提示并拒绝发送；取消不发送。确认消费暂存引用后再写入，避免同一次确认重复执行。异步剪贴板读取开始时捕获目标，重连或卸载后迟到的读取不写入新终端。

TerminalPastePreview.tsx 仅负责中文目标提示、完整只读文本预览、取消/确认及失效状态；内容通过 textarea value 显示，无 HTML 执行。文本不持久化，不 trim。最终 xterm 粘贴的换行/括号粘贴处理仍由原 xterm 完成。

接线覆盖浏览器原生粘贴、右键粘贴、Ctrl+Shift+V、公开终端 paste API、自定义快捷键 paste 动作。浏览器 paste 监听移到捕获阶段，阻止内容先被 xterm 自己的事件处理直接发送。keybinding-dispatch 增加调用方提供的可选 pasteFromClipboard 策略入口，SSH Terminal 提供连接绑定的预览策略；其他既有调用方保留兼容行为。配置的 sendText/runSnippet 动作不是剪贴板粘贴，本轮未改变。

模块边界：终端组件编排 → 本地粘贴 hook / 预览 UI → 既有 terminal.paste；没有新增后台执行接口、通用 utils 或绕过控制权网关。人工输入仍按既有规则接管，未把人工操作纳入命令黑名单。

验证：3 文件 19 项通过，覆盖单行、原始 CRLF、尾换行、取消、一次性确认、连接/会话变化、延迟剪贴板读取、卸载、中文确认与自定义快捷键策略委托。TypeScript、ESLint、翻译键检查通过（缺失 0）。日志 .cache/terminal-paste-final.log / terminal-paste-tsc.log / terminal-paste-lint.log / terminal-paste-keybinding-lint.log / terminal-paste-locales.log。

尚未重新构建目录包并进行实际剪贴板→预览→SSH 接收端验收，F03/B03 保持未完成，44/79不变。未提交、推送、打标签或触发 Actions。

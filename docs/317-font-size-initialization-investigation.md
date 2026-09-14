# 字体缩放首次尺寸不一致调查（未通过）

2026-09-13，继续 F03/B03。实机脚本通过 Ctrl+加号/减号驱动实际 xterm，独立 ssh2 服务记录 pty 和 window-change 行列数，并核对没有缩放按键写入 shell。

原报告 c3088a8c-5258-4035-a5f8-e888ad56d27b 在放大再缩小时不能返回初始尺寸。增加 document.fonts.ready、移出主机悬浮位置和等待后，3ba7934c-b8bb-427a-ac7c-71d6a5a4c03b 仍失败，window-sizes.json 为 109×42 → 95×39 → 102×44，不能把它视为简单测试时序问题。

代码审查发现多个直接 fit() 入口不经过 performFit 通知；后台在 sshStream 尚未创建时也会忽略 resize，而前端可能已设置 lastSentSizeRef。当前本地修改为监听 terminal.onResize 统一通知，并在 connected 时清空上次发送尺寸后补发当前尺寸。两处均沿用 scheduleNotify 的去抖，不新增连接或改变键盘输入。

但不能认定这两处修改解决了本次失败：重建后报告 25d14488-9e4f-47ff-9f8a-8e244385cfb1（仅 resize 监听）和 8ef79a8e-53b6-4d80-a6ae-fe687fad3808（含 connected 补发）仍在同一断言失败，尺寸序列不变。下一步应记录初始和缩放后的实际字体/字符度量、xterm 行列和发出的 resize，确认是否为字体度量初始化问题，不能继续仅凭猜测宣称修复。

本轮 build（含类型检查）成功、ESLint 无错误；字体缩放与主机配置 2 文件 48 项单元测试通过，但不能替代失败的实际 SSH 往返尺寸验收。未到达最大/最小字号断言，不声称其已通过。失败程序由专用 PID 清理，非正常退出成功证据。

脚本 .cache/run-font-zoom.cjs / font-zoom-observer.cjs；当前日志 .cache/font-zoom-desktop.log、font-sync-build.log、font-sync-package.log、font-sync-tests.log、font-sync-lint.log。F03/B03 仍未完成，44/79不变。未推送或发布。

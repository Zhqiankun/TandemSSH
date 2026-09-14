# 主题及字体选择的 Windows 桌面验收

2026-09-13，继续 F03/B03。使用当前目录包和真实 SSH shell，实际打开主机编辑器的 SSH→终端页，关闭继承外观后依次选择 Dracula + JetBrains Mono、Solarized Light + Fira Code，点击更新主机。

报告 `.cache/desktop-observation-report-e1b91b18-2160-4c38-94a9-9b83442dea8d`。每组均核对数据库主机读取接口保存的 theme/fontFamily、重新打开控件值，等待 document.fonts.ready 并验证所选字体已加载；检查实际已连接终端的背景计算值分别为 rgb(40,42,54) 和 rgb(253,246,227)。全程 WebSocket 创建计数不增加，原 SSH 输出继续可见。已查看 solarizedLight.png，浅色背景及前景文字呈现正确。

appearance-result.json 全部通过，桌面和 runner 正常退出，日志无固定认证秘密。脚本 .cache/run-appearance.cjs、appearance-observer.cjs；日志 .cache/appearance-desktop.log。未新增产品代码。

范围限制：字体已加载、选择保存和可见文本有证据，但未直接检查 canvas 内部使用的字体身份；未覆盖所有预设主题、所有字体、自定义字体缺失时的回退和重启后的外观。此脚本没有在切换后额外发送命令，不据无重连推断所有输入行为已覆盖。字号与真实 SSH 尺寸同步见 318。

F03/B03 还有完整快捷键、系统剪贴板、扩展布局、tmux 编码兼容等未完成项，整体 44/79。未推送或发布。

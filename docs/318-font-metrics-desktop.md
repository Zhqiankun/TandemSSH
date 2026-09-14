# 已加载字体重新度量与缩放实机验收

2026-09-13，解决 317 的首次尺寸不一致。

证据链：已安装 xterm 的 CharSizeService 仅在字体选项变更等时机 measure，字体文件加载完成本身不会清除缓存的 fallback 字符度量。原 document.fonts.ready 回调只有 refresh + fit，因此保持旧度量；第一次改变字号才重新计算，使缩回原字号后行列不同。317 的 resize 监听和 connected 补发不足以单独解决这一问题。

修复在现有 fonts.ready 回调中、终端仍连接 DOM 时，读取当前 fontFamily，通过公开 options 同步暂设另一字体再恢复原字体，以触发字符重测。两次赋值在同一任务内完成，下一渲染帧前恢复原设置；不调用 xterm 私有服务、不改变保存的字体/字号。随后继续原 refresh 和 fit，317 已接入的尺寸同步把正确结果通知 SSH。责任仍在 Terminal 的字体加载生命周期，无新增共享模块或依赖。

完整桌面复测成功：.cache/desktop-observation-report-790a651d-fdf1-4d25-a8f0-ed649244335d。真实 ssh2 pty/window-change 记录为初始暂态109×42 → 加载后102×44 → 放大95×39 → 缩小102×44 → 最大字号39×17 → 最小字号179×79。上下限继续按键不再产生尺寸变化，整个缩放矩阵 SSH 输入字节为零。font-zoom-result.json 全部通过；桌面和 runner 正常退出，日志无固定认证秘密。

测试通过实际 xterm DOM 键盘事件驱动，服务端记录真实 SSH 行列数；不是 Windows 系统级快捷键冲突测试。此报告覆盖字号缩放和初始字体度量，不代表所有字体选择、主题切换已完成。

相关字体加载/缩放 2 文件 8 项单元测试、ESLint、完整 build 和目录打包通过。日志 .cache/font-measure-tests.log、font-measure-lint.log、font-measure-build.log、font-measure-package.log、font-zoom-desktop.log。脚本 .cache/run-font-zoom.cjs、font-zoom-observer.cjs。

F03/B03 仍包含其他未完成项，整体保持 44/79。未推送或发布。

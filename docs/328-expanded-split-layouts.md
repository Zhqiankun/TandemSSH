# 三至六窗格真实 SSH 布局矩阵

2026-09-13，继续 F03/B03。专用 Windows 桌面创建六个不同 SSH 用户的独立真实 shell，会话各自完成指纹确认和认证。通过实际侧栏按钮从六分屏切换到垂直三分屏、水平三分屏、四分屏、五分屏、六分屏。

报告 .cache/desktop-observation-report-b890dd7e-03bf-44a4-98f1-f7a73b0dd37a。每种布局要求可见终端数与预期一致，窗口坐标可观察、用户标识唯一；逐窗格通过 Input.insertText 输入不同标记，服务端按用户名核对仅目标 SSH 会话收到。累计 21 次按窗格输入验证通过。全部布局切换前后 session id 集合不变，WebSocket 创建计数不增加。

已查看 six-panes.png，六个实际终端按两行三列显示，侧栏分配 6/6。layout-matrix-result.json 保存各布局可见窗格的坐标和尺寸、数量与唯一输入目标。桌面和 runner 正常退出，日志无固定认证秘密。

脚本 .cache/run-layout-matrix.cjs、layout-matrix-observer.cjs；日志 .cache/layout-matrix-desktop.log。使用当前 327 目录包，没有新增产品代码；服务端为受控 ssh2 shell，不宣称执行 Linux 命令。此矩阵覆盖布局切换和输入隔离，不覆盖每种布局的全部拖动比例或跨多个分屏标签恢复冲突。

结合 306/327 的双窗格矩阵，七种预设布局已有实际 SSH 基础证据。F03/B03 其余系统剪贴板、部分快捷键/外观、tmux 编码等仍待处理，整体44/79；未推送或发布。

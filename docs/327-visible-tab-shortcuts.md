# 分屏状态下可见标签快捷键导航

2026-09-13，F03/B03。AppShell 的 Alt+数字、Ctrl+Shift+左右方括号原来遍历 tabsRef.current 的全部标签，而标签栏只显示没有 parentSplitTabId 的顶层标签；分屏子终端会占用隐藏索引。两处快捷键列表现在使用与标签栏相同的过滤条件，不改变窗格导航或连接状态。

实际桌面报告 .cache/desktop-observation-report-5ee3a49f-7d81-4527-9497-bc456bd3f900：两个真实 SSH 终端纳入一个分屏，顶层仅仪表板和分屏。Alt+1/2、前后方括号切换和循环均到达相应可见标签；包含 xterm 委托入口，导航阶段无 SSH 输入。随后原双会话矩阵完整通过：分别输入、上下布局、移出窗格、关闭分屏和恢复独立标签继续输入，未重建连接。

初次 f09c6a8c...、等待布局稳定后的 29197b10... 均在导航后第二个窗格输入失败；后者接收记录只有第一个窗格输入。脚本只发送 keydown，缺少 keyup，使 xterm 保留按键处理状态。补齐按下/释放后全矩阵通过，没有把这项测试缺陷算作产品焦点修复。

tab-shortcut-result.json 与 split-native-result.json 均通过，桌面和 runner 正常退出，日志无固定认证秘密。脚本 .cache/run-tab-shortcut.cjs、tab-shortcut-observer.cjs；日志 tab-shortcut-desktop.log、tab-shortcut-build.log、tab-shortcut-package.log。完整 build（含类型检查）及目录打包成功。事件经实际 DOM 派发，不证明所有 Windows 系统级快捷键冲突。

整体仍44/79，F03/B03未全部完成。未推送或发布。

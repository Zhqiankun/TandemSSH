# 双 SSH 会话分屏桌面验收

2026-09-13，继续 F03/B03。当前目录包已包含 305 的拖动清理修复；独立测试服务用两个不同 SSH 用户标识实际 shell 输入，避免仅凭界面显示判断输入隔离。

成功报告：`.cache/desktop-observation-report-52802916-4702-4f1b-8389-34029ae85583`。`split-native-result.json` 全部通过，桌面及 runner 正常退出 0，日志不含固定测试认证秘密。已查看 `split-stacked.png`。

实际流程：创建两个隔离的测试主机，各自确认指纹并完成密码认证；通过侧栏“分屏”及“两分屏”按钮把两个现有终端纳入布局。用 Chromium Input.insertText 分别向两个实际 xterm 输入唯一标记，SSH 服务按用户名核对只在目标连接收到。切换到“水平两分屏”，核对两个终端的真实屏幕坐标为上下排列，再输入第三个标记。通过窗格标题的移出按钮释放一个终端，确认两个 SSH 会话仍连接。选择“无”关闭分屏，点击恢复的两个独立标签，分别输入新标记并核对目标接收。

整个过程的两个 session id 集合不变、WebSocket 创建计数不增加，证明本次左右/上下布局转换、移出窗格和关闭分屏未重新建立终端连接。输入隔离以 SSH 收到的实际字节验证，不是标签名称推断。测试服务提供受控 shell，不宣称执行 Linux 命令。

脚本：`.cache/run-split-native.cjs`、`.cache/split-native-observer.cjs`、`.cache/split-native-scenario.txt`。构建和打包日志：split-native-build.log、split-native-package.log；运行日志：split-native-desktop.log。

## 截图后补充汉化

截图显示新建标签仍为 Split #1，布局角标仍为 2-way-horizontal。AppShell 新建分屏改用 terminal.split.defaultTitle 插值，简体“分屏 {{number}}”、繁体“分割畫面 {{number}}”，其他语言回退英文。已有用户自定义和持久化标签不改写。SplitScreenPanel 角标改用既有 SPLIT_MODES 的本地化 label，内部布局枚举不变。

这是两个 UI 展示点及翻译词条修改，没有新增共享模块或变更会话契约。翻译键检查缺失 0；本次双会话实机报告产生于这两处汉化之前，不作为汉化后的截图证据。

本轮通过两窗格的基本输入隔离、布局切换、移出和标签恢复；未覆盖 3–6 窗格、分屏工作区重启恢复、操作系统剪贴板及完整快捷键/编码/字体主题，也未验证任意跨分屏状态恢复冲突。F03/B03 保持未完成，整体 44/79。没有提交、推送或触发 Actions。

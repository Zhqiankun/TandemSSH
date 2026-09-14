# Windows 桌面界面重载后的分屏恢复

2026-09-13，当前源码重新构建目录包，包含 306 的分屏汉化、307 的唯一归属及 308 的持久化校验。

成功报告 `.cache/desktop-observation-report-b27e3cc9-0021-45a0-9e87-379ef59bffc4`。在独立测试配置创建两个真实 SSH shell，会话分别输入已核对的标记，创建“分屏 1”并切换上下布局。只对该配置通过用户偏好接口开启 reopenTabsOnLogin，等待 termix_splitTabs 保存两项稳定实例 ID，然后通过 Chromium Page.reload 重新加载界面；正常处理 beforeunload 确认，没有绕过认证。

重载后真实点击恢复的“分屏 1”标签，两终端均可见并显示实际 SSH 输出。完整持久化布局对象与重载前一致，包括名称、模式、尺寸和窗格实例 ID。分别通过 Input.insertText 输入 RELOAD_ONE / RELOAD_TWO，SSH 接收端按用户核对，没有串到另一会话。已查看 split-reloaded.png，“分屏 1”及“水平两分屏”均汉化正确。

split-reload-result.json 全部断言通过；目录 build/打包完成，桌面正常退出，日志未发现固定测试认证秘密。脚本 .cache/run-split-reload.cjs、split-reload-observer.cjs；日志 split-reload-desktop.log、split-reload-build.log、split-reload-package.log。

本轮是实际 Electron 界面重载，不是进程退出后的冷启动，不证明 SSH 传输在重载中从未重连。测试使用受控 ssh2 shell，不声称执行 Linux 命令。复杂多分屏、全部扩展布局、损坏配置的桌面恢复仍需进一步验收。F03/B03 保持未完成，整体 44/79；未推送或触发 Actions。

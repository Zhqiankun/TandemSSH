# 分屏工作区 Windows 冷启动恢复

2026-09-13，承接 309。本次在同一专用测试配置中依次启动两个真正独立的 TandemSSH 进程，第一进程完整执行准备及界面重载流程后正常退出，端口释放；随后第二进程重新启动。不是单次 Page.reload。

报告 `.cache/desktop-observation-report-f6670aa1-8201-4aab-8dc9-c781b74b2384`，冷启动报告位于 `cold/`。`split-cold-result.json` 记录首个 PID 51480、第二个 PID 51260，同一配置路径，原生进程身份/EXE/版本均由既有观察器核对。两次程序及 runner 均退出 0。

第二次启动从本地持久化恢复“分屏 1”和两个主机标签。点击分屏后两终端实际可见，布局对象（模式、尺寸、名称、窗格稳定实例 ID）与首个进程保存的数据完全一致。分别输入 COLD_ONE/COLD_TWO，真实 ssh2 接收端按不同用户名验证仅收到对应输入，证明冷启动后的输入目标正确。已查看 cold/split-cold.png。

专用测试配置已开启 reopenTabsOnLogin；未修改用户日常配置。冷启动后建立新的 SSH 连接，不声称旧连接跨进程存活；测试服务是受控 shell，不声称执行 Linux 命令。首、次进程日志均未包含固定认证秘密。脚本 .cache/run-split-cold.cjs、split-cold-prepare.cjs、split-cold-observer.cjs；日志 .cache/split-cold-desktop.log。

本轮新增实际冷启动恢复证据，未新增产品代码。F03/B03 的完整要求还包括扩展布局、系统剪贴板、完整快捷键、编码与字体主题等，仍保持未完成，整体 44/79。未推送、打标签或触发 Actions。

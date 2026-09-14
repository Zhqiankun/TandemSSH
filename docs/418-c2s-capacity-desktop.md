# 当前桌面并发启动配额与大数据集成

2026-09-14，将414—417后端流控制/准入、远程子流与桌面配额打入当前Windows目录包。本轮只增加观察脚本。

在已核对归属的独立主进程中，仅暂停本轮33个指定端口的listen调用。通过实际Electron IPC发起32个不同名称的local启动，明确等待32次端口检查已进入暂停点；第33个启动返回C2S_TUNNEL_LIMIT。

取消第一个待启动请求后，同一第33名称再次启动可进入检查，表明名额不是永久占用。停止全部请求，再恢复原listen并放行，33个已接受启动全部以C2S_CANCELLED结束；所有端口可重新绑定，runtime为空、SSH对端数0。该场景是32个真实主进程并发请求，不是仅模拟Set容量。

随后完整运行已有监听前取消、30次立即停止、认证挂起取消、注销及明确重试，并完成8MiB中文/二进制双向回显，全部字节一致。说明限额与新背压未阻断正常分块大数据路径。

原始目录.cache/desktop-observation-report-1408636e-6003-4351-9f99-194f17ae46bd；已读取c2s-pending-capacity-result.json、c2s-large-echo-result.json。脚本c2s-capacity-observer.cjs、run-c2s-capacity.cjs；日志c2s-capacity-desktop.log。客户端cleanExit=true、脚本exit0，所有主进程暂停点恢复、SSH/Echo与业务端口关闭。

build及目录打包通过，日志c2s-capacity-build.log、c2s-capacity-package.log。当前本地包包含407—417相关修复，公开安装包不变。单监听32客户端及远程32子流的真实TCP/SSH证据分别在417/416；本轮不冒充128后端连接的整包压力测试。

F12/B13继续按原始范围归并，整体65/79。未推送Git或触发Actions。

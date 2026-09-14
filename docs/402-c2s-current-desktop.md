# 当前桌面隧道取消与监听前竞态

2026-09-14，将398/399端口预检、权限复查及中文错误打入当前Windows目录包。本轮新增观察脚本，不改生产逻辑。

## 确定性监听前取消

在已核对归属的独立客户端主进程中，仅拦截本轮测试端口的第一次net.Server.listen，暂停端口可用性检查。local/dynamic分别确认检查已进入且端口仍可被独立绑定，然后通过真实Electron IPC停止隧道；开始请求尚未完成。恢复原listen并放行检查后，开始返回C2S_CANCELLED，无runtime、无SSH连接、端口可重新绑定。finally恢复原方法，不影响其他端口。

这证明取消发生在监听之前，不以“快速点击”或多次碰运气推断时序。remote模式没有本机源端口监听，使用下述在途与认证取消证据，不能硬套同一暂停点。

## 当前桌面组合

三模式×测试/启动×5次立即停止，共30次，全部请求结束、端口释放、对端连接清空。实际中文界面测试取消与启动停止时参数锁定、取消按钮可见。三模式测试/启动各自在真实SSH密码认证挂起时停止，全部对端关闭。注销同时取消两条在途请求并释放监听；重新登记本机登录后明确重试，实际字节回显成功，再停止释放。终端会话数0，没有混入PTY。

原始目录.cache/desktop-observation-report-65031e36-9057-4958-8774-abf87bd1de8b，已读取c2s-before-listen-result.json、c2s-immediate-cancel-result.json、c2s-cancellation-result.json。即时取消bad=0；认证场景4–9ms仅为本机观察值，不是远程性能保证。

脚本c2s-current-desktop-observer.cjs、run-c2s-current-desktop.cjs，日志c2s-current-desktop.log。客户端cleanExit=true、脚本exit0，主进程拦截恢复、测试SSH/Echo端点与业务端口关闭。

build及目录打包通过，日志tunnel-current-build.log、tunnel-current-package.log。当前本地包已含398/399；本轮正常与取消实测不等于通过桌面用户管理界面再次执行撤权，后者证据仍为399/400的真实协议回归。

F12/B13/A35继续各自原始范围验收，整体64/79。持续传输后权限变化及其余范围检查仍明确保留。未推送Git或触发Actions，公开安装包不变。

# C2S 在途请求取消

状态：实施中，基线 ed3ead0。

已确认 testC2SRelay 创建的 WebSocket 不归属 c2sTunnelRuntimes；停止隧道和注销只清理运行实例，独立测试及启动验证可能继续等 15 秒，认证提示或连接也可能继续。

C2sSession 继续拥有登录代次，并登记按隧道名称分组的 AbortController。登记只存在于主进程内存，不写配置、不传给中继。每个请求完成时移除登记；停止取消指定组，登录变化/注销/窗口销毁取消全部。异常取消不能阻止其他请求清理。

main.cjs 只编排请求登记、现有监听和中继。所有端口/目标检查后的异步继续须检查 signal；测试中继监听 signal 并及时终止 WebSocket、清理计时器、只完成一次 Promise。启动验证与独立测试使用相同所属隧道名。迟到回调只能操作原 runtime，不能删除同名的新实例。

不改变共享终端人工/AI 控制权规则；本轮“停止”专指隧道停止。后端沿用已有 WebSocket 关闭到 SSH 认证取消的机制。

验收：请求作用域单元测试；真实 WebSocket 在等待认证时停止/注销，提示消失和 SSH 连接释放；旧响应不能改变新实例；三种模式正常启停回归；类型、lint、完整测试和打包原生/MCP 门禁。

界面补充：独立测试及等待中的启动显示可用的“取消”；每个界面操作有自己的身份，取消后旧 Promise 不得改状态或发成功提示。运行/认证/测试期间冻结当前行参数；任何活动隧道存在时禁止删行和加载替换预设，避免由索引、端口或主机变化使停止命中另一名称。停止后恢复编辑。此约束不改变已经运行隧道的通信行为。

## 验证结果（2026-09-10）

请求分组/注销/显式重试隔离、真实 WebSocket 取消/超时/成功关闭、中文按钮及迟到响应测试，与既有真实中继测试合计 54 项通过。取消核心完整回归 506 文件通过、1 文件跳过，3610 项通过、12 项跳过，280.09 秒。其后补充的参数锁定再次通过 54 项专项、类型检查、全库 lint（0 错误、100 项既有警告）和构建。CI 保留独立真实 ConPTY 门禁。

最终 Windows 认证等待验收：`.cache/desktop-observation-report-21c555f2-a91e-4fd1-9e06-b10f0e280623/c2s-cancellation-result.json`，截图 `c2s-cancel-pending-ui.png` 已实际查看。使用专属 SSH 协议服务器挂起密码认证，真实点击“取消”和“停止”，local/dynamic/remote 的测试与启动分别取消；注销同时关闭两个在途连接，端口全部释放。恢复本机登录并明确重连后逐字节回显通过。本机夹具观察到的取消至对端关闭为 3–8 ms，仅代表此回环环境，不是远程网络延迟保证。

正常路径复测：`.cache/desktop-observation-report-775986ed-c697-4257-8b59-e4362e0e60e5/standalone-c2s-result.json`。真实隔离 Alpine/OpenSSH 的三种模式数据、停止释放、主机身份变化拒绝、同名明确重试、中文界面启停和注销均通过。测试 VM `d52d7266-11f1-4a59-86a3-9eaec14fbb1c` 已正常退出，桌面进程正常退出并释放端口。

最终开发包 13 项原生依赖与四份项目/底座分发声明检查通过，打包 MCP 的 3 项测试通过。三份测试配置共检查 21 个 JSON/日志/数据库/录制文件，未发现本次密码或 RSA 私钥起始标记；此有限扫描不代表完整日志安全审计。

证据日志：`.cache/c2s-cancel-regression-results.json`、`c2s-cancel-lock-tests.log`、`c2s-cancel-final-types.log`、`c2s-cancel-full-lint.log`、`c2s-cancel-final-build.log`、`c2s-cancel-locked-package.log`、`c2s-cancel-locked-desktop.log`、`c2s-cancel-linux-desktop.log`、`c2s-cancel-native-probe.log`、`c2s-cancel-packaged-mcp.log`、`c2s-cancel-privacy-check.json`。

公开 alpha.0 未覆盖；本轮源码修复经推送后由 Actions 继续验证，下一次发行须使用新版本标签和 Actions 构建。仍需补齐端口监听前的极早取消、所有认证/权限撤销及完整重连矩阵，不将认证等待专项扩成全部隧道验收结论。

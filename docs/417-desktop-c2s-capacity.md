# 桌面C2S活动与在途配额

2026-09-14。C2sSession在同步登记AbortController前，对活动runtime名称与在途名称取并集，限制最多32个不同隧道名；同名最多8个在途请求。活动名称通过主进程提供的只读回调取得，不反向引用主进程。验证请求与启动使用同一入口，避免异步端口检查前都通过限额判断。

已有runtime的验证不重复占名称名额，释放在途请求不释放仍活动的runtime名额；取消清空旧请求，旧release不能误删新请求。超限使用C2S_TUNNEL_LIMIT/C2S_REQUEST_LIMIT，中文说明已补齐。

local/dynamic的实际net.Server.maxConnections设为32，超额客户端由监听层关闭，不触碰已有socket。新增真实TCP测试实际接入32个客户端，第33个关闭；旧连接回显正常，释放后补入新连接仍可回显。限额测试复用相同Node监听配置，不冒充整包原生IPC压力测试。

活动/在途名称组合及同名8请求的测试覆盖拒绝、取消和名额复用，中文组件验证两类配额错误。主进程语法检查通过，最终回归计数及类型规范结果见下方补录。

本轮新增常量属于桌面C2S会话准入模块；主进程只传活动名称并配置监听，无新通用共享层。本轮改动尚未打包；S2S资源范围仍独立核对，不把C2S配额称作整个应用硬内存上限。整体65/79，未推送Git或触发Actions。

最终3文件25项通过，tsc -b、修改文件ESLint及本地化检查通过；日志desktop-c2s-limit-final.log、desktop-c2s-limit-final-types.log、desktop-c2s-limit-lint.log、desktop-c2s-limit-localization.log。

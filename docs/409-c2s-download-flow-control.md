# 独立C2S下载方向流控制

2026-09-14，接续407/408。本地/动态C2S原来在收到WebSocket二进制帧后直接socket.write，未处理false返回值。

新增electron/c2s-download-pump.cjs，职责仅为中继WebSocket→本地TCP的写入流控制：socket.write返回false时暂停WebSocket，TCP drain后恢复；不自建数据队列。关闭时移除drain监听，迟到事件不能恢复远端读取；同步写失败交回主进程现有错误/清理路径。

main.cjs继续拥有状态和关闭，双向泵分别负责相反方向，未抽取成无业务归属共享模块；远程streamId通道未改变。

新增真实Node Writable慢写入测试：背压前缀内容保持、写入未完成不resume、完成后恢复、取消后不恢复、监听被移除、同步错误不恢复输入。与上传泵及真实TCP/WebSocket上传测试共3文件8项通过。tsc -b、新模块/测试ESLint与main.cjs语法检查通过；日志.cache/c2s-duplex-tests.log、c2s-duplex-types.log、c2s-duplex-lint.log。

本轮下载测试中的WebSocket pause/resume为观察替身，不冒充真实下载网络压力测试。仍需打包全链路双向传输、单帧限制及连接数上限核查，不能凭背压宣称全进程内存有硬上限。整体65/79，未推送Git或触发Actions。

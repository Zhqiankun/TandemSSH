# 独立 C2S 上传流控制

2026-09-14，核对09-base-features资源有界要求时，发现Electron openC2SRelay在验证等待期间用pendingChunks无限追加本地TCP数据，发送就绪后也未根据WebSocket写入完成控制读取速度。

新增electron/c2s-upload-pump.cjs，职责仅为本地TCP→C2S WebSocket方向：创建时暂停TCP；收到ready后发送SOCKS已有初始数据或恢复读取；每次数据发送先暂停，写入回调成功后才继续读取；取消后迟到回调不能resume，失败交回外层关闭连接。主进程继续拥有状态、认证、错误和资源关闭，不引入跨业务共享层。

openC2SRelay移除pendingChunks及无等待批量flush，改用该泵。取消时停止读取并移除data监听。远端→本地方向和远程模式streamId通道未在本轮改动，不把单方向流控制宣称为整体内存上限。

测试使用真实Node Readable与受控WebSocket写入回调：就绪前发送0次、初始数据顺序、每次仅一条待完成写入、中文/二进制逐字节一致、取消后的迟到回调不恢复读取、写失败不恢复读取。上传泵/会话/中继探针共3文件14项通过。日志.cache/c2s-upload-pump-tests.log；修改模块及测试ESLint、main.cjs语法检查通过。

本轮尚未打包运行真实TCP压力场景，不能把流测试当作全链路压力验收。F12/B13仍未完成，整体65/79。未推送Git或触发Actions。

最终tsc -b通过，日志c2s-upload-pump-types.log；规范日志c2s-upload-pump-lint.log。

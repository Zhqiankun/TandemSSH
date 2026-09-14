# 上传队列运行中调整并发

2026-09-13，转入 F09/B06 文件传输管理剩余验收。本轮没有修改调度实现，新增真实 UploadQueue + UploadQueuePanel 的组件/端口集成验证。

五个不同文件完成预检后，通过“同时上传”面板输入框调整并发。初始1只开始1项；改为3立即开始3项；运行中改回1时已有3项不被取消或暂停。完成其中两项后，剩余1项未结束前不会启动第四项；之后第四、第五项依次开始，活动数保持1。所有文件最终 completed，测试端口接收内容与各源文件完全一致，峰值3。

测试不是 sleep 猜测：每个 chunk 请求由独立 deferred gate 控制，等待确定的 started/active/完成状态后再推进；使用既有 manifest hash 验证端口核对块内容。与原队列回归共14项通过，TypeScript、ESLint退出0。日志 .cache/upload-dynamic-concurrency.log、upload-dynamic-concurrency-tsc.log、upload-dynamic-concurrency-lint.log。

证据范围是实际队列类与面板控件、受控 UploadApiPort，不是 Electron/真实 SFTP 并发实机测试。下载侧目前已有固定并发测试，运行中升降尚未完成，不能从上传侧推断通过。B06仍未完成，整体44/79，未推送或发布。

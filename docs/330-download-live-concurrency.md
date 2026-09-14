# 下载队列运行中调整并发

2026-09-13，继续 F09/B06，补齐 329 仅验证上传的范围。

新增实际 DownloadQueue 的五任务集成测试，五个远端 source id、本地 target id、不同内容和 SHA-256 均独立，避免复用单个假目标掩盖串文件问题。DownloadApiPort 的 chunk 用独立 gate 控制完成时机，DesktopDownloadApi 的 append 按目标累积字节并核对偏移与内容，finish 核对完整内容及哈希。

并发1时只开始1项，改为3补到3项；降回1不 abort 已活动源，也不发 pause/cancel。两项完成后第三项仍占位，不启动第四项；第三项结束后第四、第五按新上限依次启动。最终五项 completed，目标内容各自正确，峰值3。没有修改生产调度实现。

上传和下载相关2文件22项通过，日志 .cache/download-live-concurrency-tests.log。测试使用实际队列与受控远端/本地端口，不是操作系统落盘或真实 SFTP 并发证明，也不将其表述为下载面板实机操作。双向运行中并发的真实桌面流程仍待验收。

整体44/79，B06未完成，未推送或发布。

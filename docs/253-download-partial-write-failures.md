# 本机下载半块失败与恢复验证

2026-09-13，A32 的本机落盘故障证据。

## 场景

在既有 scripts/download-sink.test.ts 增加五项场景，调用实际 DownloadSink 并使用真实临时文件和 FileHandle：先写入一个完整 CHUNK_BYTES 块，再实际写入第二块 65536 字节，随后对该句柄的下一次写入注入 ENOSPC、EACCES、EPERM、EROFS。

这不是把宿主磁盘实际填满，也不是改变真实目录权限；错误由精确的单一 FileHandle spy 注入，已成功写入的数据和后续校验都来自真实文件系统，不替换整个 fs 模块。

## 验证行为

四种错误均保证：

- 返回 DOWNLOAD_DISK_FULL 或 DOWNLOAD_LOCAL_PERMISSION，状态 failed。
- writtenBytes 仍为完整已验证块，temporaryPath 指向真实残留文件。
- 暂存文件确有额外 65536 字节未验证尾部，最终目标尚不存在。
- 故障解除后恢复先验证完整块，再截去未验证尾部；重新传入剩余数据后完成，磁盘字节与源数据完全一致且 SHA-256 匹配。

第五项在错误后更改已验证前缀的一个字节：恢复返回 DOWNLOAD_CHECKPOINT_CHANGED，仍为 failed，暂存文件不被截断，最终目标不出现。

## 结果与范围

整个 download-sink.test.ts：15 项通过，其中 5 项为本轮新增。故障注入在 finally 中恢复，夹具按既有生命周期关闭句柄并清理自身临时目录。

本轮没有修改生产代码，没有新模块、共享抽象或依赖变化。A32 仍需真实故障环境/桌面反馈及远端和批次部分失败矩阵，本记录不把受控错误代码注入写成实际磁盘耗尽验收。

未提交、推送或发布。

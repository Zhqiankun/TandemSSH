# 下载批次部分落盘失败与恢复

2026-09-13，A32 下载批次证据。

在 download-directory-targets.test.ts 使用实际 DownloadDirectoryTargets、DownloadSink 和真实临时目录。三文件批次第一项先完成并登记收据；第二项实际落盘 65536 字节后对下一次 FileHandle.write 注入 ENOSPC 或 EACCES；第三项不开始。

验证结果：

- 第二项为 failed，错误对应磁盘满/权限不足，writtenBytes=0；暂存文件确有 65536 字节。
- 批次 complete 拒绝把第二项登记为完成，第二/第三最终目标均不存在。
- 不能重新给第一项分配下载目标，完成收据保持不变。
- 使用第二项原 ID 恢复，先截去未验证尾部，然后重新下载、完整校验及完成登记。
- 第一项字节、inode、大小、mtime 和收据不变；第三项没有自动执行或生成完成收据。

故障是对单一实际 FileHandle 的受控注入，不是实际填满宿主磁盘或修改权限。真实 Linux 容量故障见 254；原生单文件前缀保护见 253；上传批次见 255。

download-directory-targets.test.ts 和 download-batch-controller.test.ts：2 文件、16 项通过。无生产逻辑变化、新共享模块或依赖变化。

A32 仍待中文桌面故障与部分失败反馈的组合验收；不把测试中的内部状态直接当成 UI 已验证。没有提交、推送或发布。

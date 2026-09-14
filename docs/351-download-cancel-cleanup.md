# 下载取消清理顺序与生命周期验收

2026-09-14，继续B06/F09。

## 问题、责任与修改

当前下载队列cleanup原来先等待远端cancel，再调用本机临时文件cancel。远端响应延迟会拖延独立的本机清理。第一次桌面脚本看到“已取消”后立即检查，发现暂存文件仍在；第二次等待清理收敛后通过，因此证据支持清理延迟，不支持永久残留结论。

修改仅在ui/features/file-manager/downloads/queue.ts的清理编排：调用方已停止追加后，先调用原生目标cancel，再尝试远端cancel。原生层继续负责能力归属、路径身份及删除约束；后端继续负责远端来源释放。保留preserve条件、completed/unknown状态保护、本机清理失败的DOWNLOAD_CLEANUP_PENDING反馈与远端失败容错。未新增API、数据模型、共享抽象或依赖；没有把文件删除实现搬入UI。

新增回归挂起远端cancel响应，断言本机cancel在远端放行前已经执行。修改前1失败/8通过，修改后9项全部通过。TypeScript、ESLint、build和本地目录打包通过，日志download-cancel-order-before.log、download-cancel-order-after.log、download-cleanup-tsc.log、download-cleanup-lint.log、download-cleanup-build.log、download-cleanup-package.log。

## 原版本桌面证据

使用独立Windows客户端、真实loopback SSH/SFTP、12,582,929字节来源及本机报告目录。实际操作下载并暂停，暂停时最终文件不存在且不显示旧ETA；核对后恢复的内容与来源逐字节一致。另一项下载取消后，等待暂存清理完成，最终目标不存在，之前完成的文件内容未改变。

原版本通过报告.cache/desktop-observation-report-9771aa04-5309-4e04-8d9b-d30c6abf5b40/download-lifecycle-result.json。实际进度文本显示4194304 / 12582929字节、1010 KiB/s、预计剩余9秒；这是运行时显示证据，非精确测速保证。恢复后SHA256为4961a77462ff43a7b6a85313e655314aabaad978c048b4c9c6295d2e51b71e54。第一轮过早检查的失败报告50f29374-bd42-4eec-b2f5-cd8cf68fe85d保留。

目录选择器只固定返回本轮目录，所有传输、暂停、恢复、取消和本机写入均走产品真实路径。本次另读取39的result.json及257的download-fault-result.json，确认既有重启恢复与ENOSPC失败后核对恢复的原始结果，不把文档陈述单独当作实测结果。

## 修复版桌面复测

重新构建并打包后完整重跑相同场景通过：.cache/desktop-observation-report-69652400-2494-4279-bf92-15b0558423d9/download-lifecycle-result.json，日志.cache/download-lifecycle-fixed-native.log。暂停时无最终文件、隐藏旧ETA，恢复后完整字节与SHA256正确；取消另一项后无最终目标、无本任务暂存文件，已完成文件内容不变。报告目录实际仅保留测试哨兵及完成的暂停.bin。客户端正常退出并释放后端端口。

延迟远端响应的依赖解除由确定性回归直接证明；桌面复测证明修改后完整生命周期无回归，不宣称做了取消延迟性能基准。当前目录包已包含此修复；版本字段仍为alpha.14，公开Release并未更新。

B06仍保留上传侧当前生命周期组合证据审核等工作，整体48/79。未推送Git或触发Actions。

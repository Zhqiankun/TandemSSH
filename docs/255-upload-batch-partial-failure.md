# 上传批次部分失败与原传输恢复

2026-09-13，A32 批次故障证据。

扩展现有 upload-trees.test.ts，使用生产 UploadTreeService/UploadService、真实 loopback SSH/SFTP 和受限工作区文件。三文件批次中第一项实际上传并登记完成收据；第二项实际写入两字节暂存内容后，在适配器边界注入 FILE_PERMISSION_DENIED 或 FILE_IO_FAILED；第三项不开始。

断言覆盖：

- 第二项返回 failed 状态对象，receivedBytes=0，temporaryPath 指向内容为 da 的真实暂存文件，最终目标不存在。
- 第一项内容、稳定属性和完成收据保持不变，不能重新 prepare 已完成条目。
- 第三项目标不存在且无完成收据。
- 在第二项原传输 ID 上 resume，校验并截去未验证尾部，重传后提交成功；第一项仍不被覆盖，第三项仍不自动执行。

这里故障由指定一次 writeAt 调用注入，部分字节实际经过 SFTP 写入；不是实际服务器权限变化或磁盘耗尽，真实 Linux 故障另见 254。

首次断言误以为上传失败会 reject；实际契约返回带 error 的 failed 状态对象。按既有契约修正后通过，没有修改生产行为。稳定属性检查排除读文件本身可能更新的 atime。

upload-trees.test.ts 与 upload-batch-recovery.test.ts：2 文件、21 项通过。TypeScript、ESLint 通过。无新增生产模块、共享抽象或依赖变化。

仍需中文桌面部分失败及下载批次矩阵，A32 不改为完成。未提交、推送或发布。

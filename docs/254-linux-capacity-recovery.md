# 真实 Linux 限容保存失败与恢复

2026-09-13，A32 远端实际故障证据。

## 环境

项目现有 Linux lab 在隔离虚拟机内创建容量 1048576 字节的 tmpfs /mnt/tandem-full，以及 root 所有、权限 0700 的 /srv/tandem-denied。本轮实例 ea8c66ad-ccc8-42f2-9a3b-d422ea8d1032，实际非 root SSH 用户 alpine。

仅占用隔离的 1 MiB 文件系统，不填满宿主工作区或业务服务器。使用实际 OpenSSH/SFTP 和生产 DocumentService/SftpFileIO。

## 本轮扩展

原有保存空间不足测试仅核对失败及原文件不变。现在进一步核对：

- 尝试将 2 MiB 内容保存到限容盘，返回 FILE_IO_FAILED、commitMayHaveOccurred=false。
- 返回的 temporaryPath 位于本轮限容盘，符合 .tandem-save-UUID；真实 stat 证明残留文件大于 0 且小于完整内容。
- 原文仍为 original，没有被失败提交覆盖。
- 测试操作者明确删除已报告的暂存文件后，路径确实消失；重新以新 requestId 保存中文内容，真实原子覆盖成功且文件字节正确。

删除为测试显式清理，不是产品自动删除残留。若失败使暂存路径无法确认，不声称会自动清理。

## 实际结果

设置 TANDEM_LINUX_MANIFEST 后执行 ssh-acceptance.test.ts 中 real Linux permission denial 与 real bounded filesystem 两项：2 项通过，其余因名称筛选未执行，不将其算作整套 Linux 验收通过。

报告 .cache/file-capacity-results.json，日志 .cache/file-capacity-tests.log。

权限拒绝使用真实受限目录，返回 FILE_PERMISSION_DENIED。空间不足来自真实 tmpfs 容量耗尽；SFTP 只返回一般失败状态，因此保留 FILE_IO_FAILED，不猜测为更精确的远端错误码。

TypeScript、ESLint 通过。生产代码未新增变更；只扩展既有 Linux 测试职责，无新共享抽象或模块依赖。

## 剩余

仍需整合中文桌面中的故障反馈、批次已完成项与残留目标矩阵；A32 继续未完全验证。本轮没有提交、推送或发布。

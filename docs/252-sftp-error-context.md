# SFTP 不支持错误按实际操作分类

2026-09-13，A32 失败反馈检查中的修复。

## 缺陷

SftpFileIO 的共用错误映射原本把状态码 8 或“不支持”消息统一解释成 FILE_ATOMIC_REPLACE_UNSUPPORTED，并附带 commitMayHaveOccurred=false。这个映射同样被读取元数据、普通无覆盖重命名等操作调用，导致用户看到与实际操作不符的原子覆盖说明。

新增测试在修复前复现三项失败：读取时返回不支持状态、读取时收到客户端扩展不支持异常、普通无覆盖重命名返回不支持。

## 修复边界

sftp-io.ts 私有请求/错误映射增加原子覆盖上下文，只有 replace(..., allowOverwrite=true) 的 POSIX rename 扩展调用使用。其他操作回到既有 FILE_IO_FAILED；明确的文件不存在与权限不足映射保持不变。

未创建新共享模块或公开错误码，UI 沿用已有中文翻译。依赖方向仍是文件用例调用 SFTP 适配器，未改变路径授权、实际覆盖策略或未知结果恢复机制。

## 验证

- sftp-error-scope.test.ts + 真实 sftp-protocol.test.ts：10 项通过，包含原子覆盖拒绝与安全另存为。
- 文件测试目录：25 文件、209 项通过，日志 .cache/sftp-error-regression.log。
- TypeScript、ESLint、git diff --check 通过。

错误分类专项使用受控 SFTP 回调，真实协议回归另行验证扩展不支持路径。本轮不声称实际磁盘满故障已验收，不将 A32 整项标记完成。

本地源码已更新，桌面包尚未重新打包。本轮没有提交、推送或触发 Actions。

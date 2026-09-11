# Windows 本地图像目录设置往返

2026-09-12，回归清单中有一个 Windows 专门跳过的设置保存用例。原因是 localDir 保存时经 path.resolve 转为 Windows 原生路径，读取时却被与远端路径共用的反斜杠拒绝规则判为无效，导致配置无法正常往返。

修复在 parseImageLocalDir 内仅将 Windows 分隔符临时转换为斜杠做语法检查，返回值仍使用宿主 path.resolve。这样持久化的原生目录可重新读取；相对路径、明确的 .. 段、控制字符、UNC 与设备路径继续被拒绝。parseImageHostPath 保持 POSIX 绝对路径规则，不接受 Windows 盘符或反斜杠。

责任仍在既有终端图片存储设置模块，没有新共享抽象、数据库格式或公开响应字段变化。localDir 仍为后端内部字段，不加入公开设置响应。恢复启用 Windows PATCH 保存用例，并新增原生路径幂等与拒绝边界测试。

2 文件 / 24 项通过，Windows 保存用例实际执行而非跳过。修改文件 ESLint 通过，类型检查结果另行记录。证据 .cache/image-storage-windows-tests.log、.cache/image-storage-windows-lint.log。此测试验证设置解析、持久化与公开形状，不代替完整图像传输界面验收。改动在 alpha.4 标签之后，后续版本发行。

完整类型检查及后端版本元数据生成通过，日志 .cache/image-storage-windows-types.log。

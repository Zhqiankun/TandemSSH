# 主机导出缓存状态与最终秘密排除

2026-09-13，F01/B01 局部修复。

1. 初次无凭据导出已缓存，切换包含凭据后请求未完成，再取消勾选时缓存分支只 setRaw，遗漏 setLoading(false)。旧请求已取消回写，导出按钮因此持续禁用。现在命中缓存会同时结束加载。
2. 回归进一步发现 buildExportPayload 在 withCredentials=false 时只清理部分嵌套字段，顶层密码和关联凭据数组仍依赖输入预先脱敏。现由最终文件构造器将已知秘密字段置空，并保留 alias/name/username 等非秘密引用信息；旧完整请求迟到不覆盖当前无凭据导出。
3. 预览原只遮盖主机记录。现同时遮盖 credentials 数组中的已知密码、privateKey、keyPassword 等，以及 terminalConfig.sudoPassword。包含凭据的最终下载仍保留用户显式选择的秘密，预览保持遮盖，源对象不修改。

模块职责保持：HostExportDialog 管理请求/缓存与用户选择，host-export-payload 管理最终导出与预览结构。没有新增共享模块、接口或后端权限变化。

测试：先复现按钮持续禁用；仅修复加载后下载字节断言发现顶层密码仍被保留，因此继续修复构造器。最终 2 文件 25 项通过，覆盖旧请求迟到、Blob 文件实际字节、已知顶层/嵌套/凭据数组秘密清理、包含凭据时保留、预览遮盖与源数据不变。TypeScript、ESLint、diff 检查通过。日志 .cache/host-export-cache-before.log / host-export-cache-after.log / host-export-security-final.log / host-export-security-tsc.log / host-export-security-lint.log。

边界：此轮未声称复现实际外部泄露；秘密字段用测试值验证。任意备注、脚本或未建模的高级字段仍需用户检查，不能把已知字段清理称为任意文本秘密检测。后端导出端点与真实文件下载/重导入还需继续核对，目录包尚未重建。38/79 计数不变；未提交、推送、打标签或触发 Actions。

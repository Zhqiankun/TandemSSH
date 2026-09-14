# 导入无效凭据引用时拒绝自动改绑

2026-09-14。A22核查发现 bulk-import 对无法解析的 credentialId 会改用用户第一份现有凭据；没有现有凭据时还可能退回导入的 key/password。这会把未明确选择的认证材料绑定到导入目标。

本轮修改 host-bulk-routes.ts 的凭据解析分支：引用不存在或不可访问时，该条导入失败并返回 HOST_IMPORT_CREDENTIAL_NOT_FOUND 与中文“引用的凭据不存在或不可用，请重新选择凭据后导入。”。不选择其他凭据或认证方式。有效引用、别名解析、认证材料显式导入和批次部分成功语义保持现有路径。

责任仍归主机导入接口；使用既有 CredentialRepository 用户范围查询，不增加共享模块或改变依赖方向。此修复只针对显式 credential 引用的失败处理，不自动迁移已被旧版本错误绑定的记录。

真实 HTTP→加密仓储→SQLite 新增两个用例，分别新增与覆盖。构造一份无关现有凭据、错误 ID 和附带 password：修复前两项均错误成功；修复后均 failed=1、success/updated=0，原主机完整解密快照不变，原凭据仍存在，响应不泄露测试密钥。首次夹具引用了旧测试数据库，校正为当前工厂返回值后才复现产品问题；日志均保留。

host-import-desktop-http 全9项通过；host-bulk-routes与host-import-activation回归通过，计数见 .cache/import-credential-regression.log。tsc -b 与修改文件 ESLint通过。日志 import-credential-before.log、import-credential-reproduction.log、import-credential-final.log、import-credential-types.log、import-credential-lint.log。

尚未打包桌面验证本轮错误提示及覆盖差异。A22继续未完全验收，整体60/79。未推送Git或触发Actions，公开安装包不变。

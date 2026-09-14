# 导入凭据归属与正常引用回归

2026-09-14，补充377的导入边界，只修改测试。

真实 HTTP→加密仓储→SQLite 覆盖四种组合：引用自己的/其他用户的凭据，各自执行新增/覆盖导入。先创建一份不应被选中的本机凭据，再创建被明确引用的目标凭据，防止测试因只有一份凭据而漏掉选错账号。

其他用户的凭据引用统一返回 HOST_IMPORT_CREDENTIAL_NOT_FOUND，该条失败；导入者的原主机解密快照保持不变。明确引用自己的有效凭据正常导入，绑定目标ID而非第一份凭据，不复制密码/私钥，隧道保持停用；覆盖时保留原主机ID。另一用户的主机列表为空，目标凭据仍存在，响应不包含测试密钥。

host-import-desktop-http.test.ts 全13项通过，日志 .cache/import-credential-ownership.log。这证明上轮拒绝逻辑同时保持正常引用兼容性，不把“所有导入都失败”作为安全验证。

没有新增生产模块、共享抽象或依赖变化。本轮未测凭据别名歧义，也未替代打包桌面错误提示验收。A22继续未完全验收，整体60/79。未推送Git或触发Actions。

最终 tsc -b 与修改文件 ESLint均通过，命令链exit0。日志 import-credential-ownership-types.log、import-credential-ownership-lint.log。

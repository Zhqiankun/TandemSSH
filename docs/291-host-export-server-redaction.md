# 无凭据主机导出的服务端响应清理

2026-09-13，F01/B01，承接 290。

检查实际 /host/db/hosts/export 路由发现 share 模式对顶层密码置空，但 terminalConfig、guacamoleConfig、socks5ProxyChain 解析后直接返回。现对 share 模式每条最终导出记录调用 stripHostExportSecrets，清理已知顶层认证字段、terminalConfig.sudoPassword、guacamoleConfig.gateway-password 和代理链 password。完整凭据导出分支保持不变。

stripHostExportSecrets 归属现有 host-normalizers 模块的响应转换边界，保留 null 占位、凭据 ID/alias 和非秘密连接配置，不增加普通主机列表的 hasPassword 等 UI 标志，不修改源对象。与现有 stripSensitiveFields 语义不同，未为复用它而污染导出格式。

服务端转换、前端文件构造及导出对话框联合回归 3 文件 62 项通过，验证已知秘密清理、连接定义及引用保留、源数据不变和无可选配置的兼容。TypeScript、ESLint、diff 检查通过。日志 .cache/host-export-server-redaction.log / host-export-server-tsc.log / host-export-server-lint.log。

本轮证据是转换函数及组件测试，加上对真实路由接线的源码核对；尚未重新打包执行原生桌面下载与实际 HTTP 响应验收。任意自由文本或未建模高级字段中的秘密不在已知字段清理保证内。整体仍 38/79；未提交、推送、打标签或触发 Actions。

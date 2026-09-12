# MCP 生产会话访问边界

新增 `app/src/backend/tests/mcp/production-session-access.test.ts`，捕获生产 McpCore 组合入口，保留实际生产 hosts/output/open 回调及真实 McpCore 调度。数据库仓库、SessionManager、其他业务组合及 OS 密钥存储使用测试替身，不启动后台桥接或真实 SSH。

本轮没有生产行为、接口、共享抽象或依赖方向变更。

## 验证内容

- sessions.output 对其他用户、未授权主机、不存在会话返回 SESSION_NOT_FOUND；读取历史端口没有调用。
- readTerminal=false 时返回 MCP_TERMINAL_READ_DENIED，连会话查询也不发生。开启后原身份取得带 untrusted-terminal-output 标记的中文正文。
- hosts.list 将当前用户传给仓库查询，过滤未授权主机，只输出 id/name/address/port，测试输入中的密码与私钥字段不返回。
- sessions.open 先检查配对主机范围，再检查仓库归属；失败时不创建桌面打开请求。合法请求返回 pending 并保留身份、hostId 与 requestId。

app 目录执行：

```text
node node_modules/vitest/vitest.mjs run src/backend/tests/mcp/production-session-access.test.ts src/backend/tests/mcp/output-gap.test.ts src/backend/tests/mcp/session-requests.test.ts
node node_modules/typescript/bin/tsc -b
node node_modules/eslint/bin/eslint.js src/backend/tests/mcp/production-session-access.test.ts
```

3 文件、10 项测试通过；类型和 ESLint 通过。既有测试覆盖输出缺口、游标、桌面打开请求去重、跨用户领取和撤销后请求失效。

## 证据限制

新增测试未验证真实仓库的用户隔离实现，也未执行 SSH 打开、桌面点击或原生认证；它验证生产组合回调的查询约束、权限顺序与输出投影。sessions.list 的生产实现和 start_task 的入口权限还需要与已有证据一起完成最终工具清单核对。测试不构成全部 F10 验收，不发布新安装包。

# MCP 配置接口所有权验证

2026-09-12，继续 F10。将配置生成放入 mcp/client-configuration.ts，用例只接收配对元数据列表、桥接启动端口和固定可执行文件路径，不持有秘密存储端口。production.ts 负责装配；http-routes.ts 继续负责人工身份和 UUID 输入检查，依赖方向不变。

## 行为

输出仍为 command、stdio 参数、公开 profile/client ID 和 ELECTRON_RUN_AS_NODE。新增启动前所有权/启用检查，避免未知、其他用户或撤销配对先触发桥接启动；保留启动完成后的再次检查，防止等待期间撤销后仍返回配置。

## 实际验证

真实 Express HTTP 路由接真实 PairingRegistry 与 buildClientConfiguration；注册表存储和凭据端口使用测试内存，桥接启动为可控 Promise，认证中间件注入测试身份，不能声称此处验证了 JWT 本身或真实 OS 凭据读取。

7 个接口用例覆盖：

- 当前用户的启用配对返回精确字段，秘密端口没有读取，输出不含测试秘密的 hex/base64。
- 其他用户、未知配对、撤销配对返回相同的 MCP_CLIENT_NOT_FOUND；桥接启动未被调用。
- 缺少人工身份或以 API Key 身份访问，在路由防线返回 TRUSTED_UI_REQUIRED。
- 桥接启动挂起时撤销，启动完成后仍拒绝返回配置。

配置接口与注册表共 13 项通过；随后全 MCP 目录 13 文件、51 项全部通过，含既有真实 stdio 测试。两组数量有重叠，不能相加。ESLint、TypeScript、diff 检查通过。

## 剩余范围

配置字段格式、复制反馈见 210，控制权与撤销见 208/209。F10 的全部工具权限矩阵仍待归并，不因配置接口通过就整体标为完成。此变化尚未进入公开 alpha.12，后续版本再发布。

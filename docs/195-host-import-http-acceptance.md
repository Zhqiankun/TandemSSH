# 桌面主机导入：真实 HTTP 与 SQLite 验证

2026-09-12，为 194 的停用激活状态修复补齐路由落库证据。本轮新增测试，无生产行为修改。

## 实际链路

通过真实 Express Router 在 127.0.0.1 随机端口接收 fetch 请求，调用实际 registerHostBulkRoutes、HostRepository、HostResolutionRepository、CredentialRepository、DataCrypto 加解密及 SQLite。工厂只替换为这些测试数据库实例，桌面运行策略固定为 desktop=true。认证中间件直接注入固定测试用户，解锁密钥为固定夹具值，因此不声称验证 JWT 或操作系统凭据读取。

四种场景均通过：

- JSON /bulk-import：新增、覆盖。
- SSH 配置 /ssh-config-import：新增、覆盖。

每种场景独立数据库。覆盖先写入带专用自启动凭据的旧主机，实际请求后断言仍只有一条记录且 ID 不变；新增断言 success=1，覆盖 updated=1，failed=0。数据库原始行证明后台功能标记关闭、专用自启动凭据为 null、采样停用。JSON 隧道端口与定义保留而 autoStart=false；其他用户没有被写入主机。

## 验证记录

host-import-desktop-http.test.ts 的 4 项、host-import-activation.test.ts 的 6 项，共 10 项通过；ESLint、TypeScript 通过。HTTP server 与 SQLite 在每例结束关闭。

首次覆盖测试失败是夹具只设置 validateUserAccess，没有设置 getUserDataKey，解密列表按未解锁状态返回空数组；补齐正常解锁状态后通过。第一次补丁因格式锚点不匹配未生效，随后修正，未把失败运行计为通过。

## 剩余范围

本轮完成 194 中“真实路由新增/覆盖”的缺口；A22 仍待打包桌面的文件选择、取消、确认和高级配置行为归并。未验证覆盖时已经运行的隧道/采样资源停止，也未把这些数据测试泛化成全流程授权或无网络连接证明。公开 alpha.9 尚未包含相关修复。

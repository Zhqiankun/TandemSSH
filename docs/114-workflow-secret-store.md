# 流程秘密存储边界（实现中）

2026-09-12，对应 08 的 secret-ref 缺口。当前只实现存储基础，尚未接入流程运行；SECRET_TRANSPORT_UNSUPPORTED 继续生效。

## 已确定的边界

- workflows/secrets/system-store.ts 属于流程模块，使用独立 OS 凭据命名空间 TandemSSH Workflow Secrets；不复用 MCP 配对或 SSH 登录秘密。
- 引用由 profileId、userId、secretId 构成，规范 JSON 元组的 SHA-256 作为 OS 账号键；无明文文件或环境变量降级。存储适配器不代替用途授权，后续流程用例必须先检查用户、主机、任务及具体操作权限。
- write 复制输入后写入，完成后清零副本；use 只在异步消费回调期间提供字节，完成或失败后清零；没有返回秘密的路由/MCP 工具。remove 只删除指定引用。
- 单项 1—2048 字节，本轮真实 Windows 凭据库验证最大长度。库和 OS 的内部副本无法由 JavaScript 保证全部清零，不作零残留承诺。

## 实际验证

流程秘密和 MCP 原命名空间共 4 项通过，报告 .cache/workflow-secret-store-results.json。使用全新 UUID 测试条目：存取、跨 profile/user/secretId 隔离、无效大小不会覆盖旧值、回调失败清零、删除后不可读取。测试最终清理条目，未读取既有用户凭据。ESLint 通过。

实测 @napi-rs/keyring 2.0.0 的 getSecret 在 Windows 返回 number[]，声明却是 Uint8Array。曾误判为 Buffer/realm 问题；仅输出类型和长度后确认。适配器现对数字数组逐字节校验再转换，并清理原数组与消费字节；无诊断日志留在产品代码。

## 后续接线责任

流程用例负责引用元数据、用途与授权、撤销和预览；OS 适配器只存取。执行适配器必须证明秘密不进入 argv、环境、模板、审计或普通终端回显，且接管后不继续写入。当前共享 PTY 没有秘密 stdin 契约，不能把加密存储误当成传输问题已解决。需先确定与共享 Shell、输入回显、取消和结果脱敏兼容的执行协议，再接 schema、UI 及 AI/MCP 流程调用。现阶段无新模型可用能力、无迁移或自动导入。
tsc -b 类型检查通过。

## 异步读取撤销检查

后续 use 接口改为强制提供同步 assertAuthorized 回调：在 OS 读取前、规范化字节后且消费前各检查一次。已撤销时不读取，读取期间撤销时不调用消费方，原始及规范化字节均清零。调用方必须实现真实任务/用途检查，不可把此参数视为已经实现授权服务；未来执行端在任何后续异步等待后的写入前也必须重新检查。

新增可控原生层测试覆盖读取期间撤销、成功交付、畸形原生字节拒绝、原生错误不泄露详情；真实 Windows 存储测试继续通过。2 文件 / 7 项通过，.cache/workflow-secret-revocation-results.json；ESLint 通过。未新增 HTTP 或模型工具，安全秘密传输仍未接入。
该次授权检查变更的 tsc -b 类型检查通过。

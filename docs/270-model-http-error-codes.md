# 模型任务保留认证与限流错误分类

2026-09-13，A23 修复。

## 问题与修改

模型 HTTP 适配器已通过 AiProviderError.status 区分 401/403 和 429，但任务生产适配层将英文错误全部转换为 MODEL_REQUEST_FAILED，用户无法区分认证/访问问题和限流。

现在仅对实际 AiProviderError 的已知状态分类：401/403 → MODEL_AUTH_FAILED，429 → MODEL_RATE_LIMITED。不透传服务商错误正文；其他状态保持通用失败，既有响应超时/容量边界代码继续保留。403 不武断解释为 Key 拼写错误，中文说明同时提及认证、访问和模型权限。

英文、简繁中文及其他语言英文回退已添加到任务与协作错误区域。没有自动重试、扩大预算或修改 SSH 路径。

## 边界与验证

生产责任仍为 ai/tasks/production.ts 的外部模型适配与脱敏，未新增共享模块、接口或反向依赖。

production-provider-errors.test.ts 捕获生产组合传给协调器的真实 stream 端口，模拟提供者错误；生产组合所依赖的数据库/授权等外围端口受控。修复前三项认证/限流断言失败，修复后通过；检查错误正文中的测试 Key 不进入最终错误，并确认临时 config.apiKey 已清空。此处不声称 V8 字符串被物理擦除。

与 provider-http.test.ts、task-runner.test.ts 共 3 文件、22 项通过，包含既有真实 loopback HTTP 适配与任务循环回归。TypeScript、ESLint、翻译检查通过（缺失键 0）。

仍需真实中文桌面的错误 Key、无工具能力、限流及人工 SSH 可继续操作组合，A23 不改为完成。当前本地目录包尚未包含本轮分类修复。未提交、推送或发布。

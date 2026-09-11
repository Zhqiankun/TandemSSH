# 自带模型接口与双模式预算复核

2026-09-12。

新增真实 HTTP 适配器用例：本机 OpenAI 兼容服务位于自定义 /custom/provider/v1/ 前缀，分别收到 /models 和 /chat/completions；Bearer Key、模型 ID、stream 和工具定义逐项核对。服务返回中文文本和跨帧工具参数，适配器还原为正确 run_command。Key 只在授权头，不进入请求正文。使用实际 providerFetch/dispatcher 和 HTTP server，未调用外部付费模型。

生产 ai/tasks/production.ts 根据用户和 providerId 查找配置及加密秘密，经 providerType 对应适配器发送 baseUrl/apiKey/request.model；每次请求复核模型配置 identity，配置改变不会静默切换端点。中文表单提供自定义接口、Key、模型和预算。此前 102/107 的 Windows 生产链已使用用户配置的本机端点。

因此 R07 原文“自定义接口地址、模型和 Key，直接使用用户选择的服务商”可按此范围标记 verified。普通聊天持久化、完整供应商兼容矩阵和全局资源边界不能当成 R07 的额外门槛，也不会因此被宣称完成。

预算用例扩展为 automatic / collaborative：两次调用（含规划）耗尽后 MODEL_BUDGET_EXCEEDED，控制权 human；增加预算后经过调度周期仍只有两次调用且未取得控制权；重新授权后完成。协作首命令先得到独立批准。运行 3 文件 / 27 项通过，报告 .cache/byok-budget-results.json，修改测试 ESLint 通过。

本轮只增加断言和验收记录，未改变产品 API 或模块依赖。A24 仍需把预算失败后的中文提示及明确恢复入口做对应界面验收，不以本轮测试代替所有 UI 行为。
本轮 tsc -b 类型检查通过。

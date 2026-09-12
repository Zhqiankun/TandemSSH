# 导入边界：流程部分验证

2026-09-12。原始 A22（docs/06-delivery.md）同时包含恶意流程、连接、规则导入，要求只预览、不自动执行、不自动放宽权限。本轮仅完成流程部分，不将 A22 标为整体通过。

## 实现边界

WorkflowLibraryBody 上传文件 → workflowApi.inspect → 后台 inspect-import → WorkflowLibrary.inspectImport → 严格 parseWorkflow。检查不保存、不创建任务。人工勾选审阅并点击保存后，save 校验显式主机归属及修订，审计后写流程库；开始任务是独立入口。本轮只补充测试，没有改变生产依赖或授权规则。

## 实际证据

中文 UI 测试使用真实 WorkflowLibrary、TaskRuntime、SessionControl；API 适配被测试代理替换并直接调用实际服务，存储为内存夹具、终端写入为观察数组，因此这是界面与用例集成测试，不声称真实 HTTP/SSH 桌面验收。

新增 5 个用例：

- 分别导入 allowedHostIds、policy、authorization、autoRun 额外字段，均显示“流程定义格式不正确，请检查标出的字段。”；保存数据、策略快照、控制权快照均不变，没有 preview/start/save 调用，也没有任务创建或终端写入。
- 合法 bash 脚本导入后保存按钮须勾选人工审阅才可用；检查阶段不入库；明确保存后仅增加流程，范围仍为当前主机 [1]，策略和控制权不变，无任务与命令执行。

WorkflowLibrary.test.tsx 与 workflow-library.test.ts 共 24 项通过；其中既有用例还覆盖未绑定导入流程拒绝预览、所有权和修订检查。针对性 ESLint 与 TypeScript 通过。

## 剩余范围

A22 的连接与规则导入仍须独立检查预览、显式确认及不扩权边界。F11 的其他流程执行、恢复和父任务标准不由本轮替代。测试已覆盖的正常脚本保存不代表导入脚本可自动运行；启动和任务授权仍是后续独立步骤。

# 保存流程参数与人工入口规则复核

2026-09-12。当前流程定义/库/父任务、内置 AI、MCP 目录流程和中文流程界面共 6 文件 / 46 项通过，.cache/workflow-requirement-review-results.json。原始 workflow-live-evidence、workflow-download-evidence、workflow-import-evidence 已重新读取：真实 Windows/Git Bash 的参数原值输出、顺序执行、修订快照、接管恢复，以及 1268 字节 JSON 完成下载/重新导入均有记录；这些是历史实机记录，不称为本轮重跑。

新增人工界面测试连接真实 WorkflowLibrary 与 TaskRuntime：printf 命中 deny 时，预览后“创建任务并前往授权”禁用，点击不调用开始接口且任务和写入为空；预览后策略 revision 改变，点击开始由服务拒绝，界面报错且无任务和写入。扩展后的界面 11 项通过。结合父任务已知 deny 预检及 15 的真实桌面拒绝预览证据，A26 可标记 verified：人工启动流程不等于自由人工终端输入，仍走硬规则。

已核对父流程并发约束：活动流程期间父任务另发命令返回 WORKFLOW_PLAN_IMMUTABLE，实际仅有流程 pwd/printf；人工接管后旧步骤 unknown，需明确核对后恢复，原结果不被改写。

R09 保留未全部完成：原 08 文档要求 secret-ref 参数按用途/权限引用且不回显。当前明确返回 SECRET_TRANSPORT_UNSUPPORTED，尚未实现安全秘密传输，不能以普通参数通过代替此要求。后续需定义按 stdin/专用通道交付秘密的契约和用途边界，不能将其降级成 argv/环境变量明文。普通自定义串行流程、模板快照与 AI/MCP 调用已有实现和证据。

本轮只增加测试与证据，产品行为及模块依赖不变。
新增测试 ESLint 与 tsc -b 类型检查通过。

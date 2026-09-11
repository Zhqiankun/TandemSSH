# 流程失败停止与运行快照验收

2026-09-12，原始A19/A21专项。本轮不修改生产行为，使用真实WorkflowLibrary、TaskRuntime、SessionControl与既有执行测试端口。

A19：自动/协作两种模式保存三步流程pwd→false→printf，未设置continue。协作模式逐项批准前两步；第二步退出码1后流程paused-error，操作记录只有成功/失败两项，准备和写入序列均无第三步。实际TaskPanel接到TaskRuntime，显示“命令失败，后续步骤已暂停。”，写入仍仅pwd/false。显式配置的continue行为继续按文档15处理，本项验证默认stop，不取消已支持的用户选择。

A21：第一步pwd已经写入并等待结果时，保存同一模板的新版本，将第二步参数改为new-version。释放第一步后，本次第二步仍使用原参数[%s,hello]，运行摘要revision仍为旧值；同一父任务再次预览运行后采用new-version与新revision。没有把运行中的定义引用直接改掉。

后端流程库/父流程两文件24项通过，真实TaskPanel组件12项通过，共36项；ESLint与tsc -b通过。执行端口为测试夹具，本轮不冒充新一次真实SSH实机执行；既有实机流程证据见15/31/36。两项具体业务不变量有直接运行证据，因此将A19、A21标记verified，R09秘密步骤及其他完整流程要求仍继续。

# 真实 MCP 失败与人工接管的桌面历史

2026-09-12。先只读汇总三个既有恢复profile，发现其operation.completed均为成功，不用这些记录证明失败/unknown显示。随后启动隔离Alpine/OpenSSH VM 8e2168b2-fed6-47af-b112-946f5f8b70b0，用最新本地Windows目录包与独立profile，通过真实MCP stdio配对创建任务。

报告 .cache/desktop-observation-report-aacf4e61-c969-4c31-afb8-31c15bbacccf/history-failure-desktop-result.json。桌面明确授权ls/sleep及/home/alpine范围；MCP run_command查询测试根目录下不存在路径，真实退出码1，任务与历史均为failed。第二任务派发sleep 30，等实际操作status=running后通过桌面人工接管；历史为unknown、exitCode=null、error=RESULT_UNKNOWN，没有成功退出码。

两条记录均从桌面按任务筛选历史，核对MCP来源、自动模式、真实主机快照与策略v1。history-failed.png、history-takeover.png保存；后者已查看，中文“失败/中断原因: 结果未知，请人工核对后决定下一步。”和“结果未知”明确可见。没有付费模型调用。客户端正常退出，测试启动器finally清理独占远端目录，配对清理/客户端关闭步骤执行。

截图暴露一处措辞：operation.intent在真实写入之前持久化，却被命名为“开始执行”。按gateway实际顺序改为中文“准备执行”、英文“Preparing execution”，不改记录类型或执行状态。截图是这处纯文案修正前的界面；翻译键检查0缺失，无需把它当作新执行机制。

本次是新增真实MCP+SSH失败和执行中接管验收，不是伪造历史数据；所用本地包包含alpha.6标签之后改动，不冒充公开alpha.6。仍不把R05/F08全部范围自动标记完成。

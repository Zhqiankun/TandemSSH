# 失败与接管结果的历史摘要

2026-09-12。历史记录本身已保存 operation.error，但历史 DTO 和摘要未投影此字段，用户需要打开详细原始记录才能看到原因。新增可选 error，reader 通过现有 text/redact 路径限制512字符并再次脱敏；HistoryRecordSummary 复用中文协作错误字典，未知文字按React文本转义显示。缺少原因的旧记录不补写，状态及退出码不被修改。

真实 TaskRuntime→AuditJournal→历史查询补充两条自动MCP命令链：exitCode=2及permission denied保留为failed；实际SessionControl写入pwd之后人工takeover，完成记录为unknown且有原因，不出现退出码0。第一次接管测试只等到prepare发生，实际得到正确的cancelled-before-send；改为等到真实写入口后才takeover，区分两个状态，不放宽生产行为。

三文件61项通过：任务运行时、磁盘JSONL审计、实际中文摘要组件；覆盖原因脱敏/限长、旧记录缺省、unknown中文解释、非可信HTML样式文本不执行。ESLint、翻译缺失键检查通过。执行器仍为测试端口，不冒充新增真实SSH中断实测。

模块责任：共享历史DTO增可选字段；后端读投影负责脱敏；UI只读解释，无新增通用抽象，也未修改任务授权或写入路径。文件操作记录与完整桌面时间线仍需继续验证，R05/F08不据此整体完成。
最终 tsc -b 类型检查通过。

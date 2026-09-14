# 历史列表显示未知命令的人工核对摘要

2026-09-13，承接 276/277，F08 / R05 局部补齐。

原生桌面归档后审计已保留 reviewedUnknownOperations，但历史列表只投影常规字段，人工确认仅能在原始详情 JSON 中找到。本轮在历史摘要中显示“已人工核对 N 项未知命令；原执行结果仍为未知。”

文件职责：types/task-history.ts 新增可选 reviewedUnknownCommandCount；audit/history-reader.ts 只对 task.archived 事件投影通过严格校验的唯一 UUID / unknown 集合计数；HistoryRecordSummary.tsx 负责中文及其他语言摘要。原始状态与详情不改写。没有新增共享模块或依赖方向变化。

只接受 1–4096 项、每项仅 id 与 status=unknown、ID 为 UUID 且不重复的集合。缺失、空值、格式错误、其他状态、重复 ID 或仅 task.archive-requested 不显示“已核对”的完成摘要。旧记录仍按原字段展示。

验证：新增测试先出现 2 项失败，修复后历史读取、来源摘要与 TaskHistory 共 3 文件 42 项通过。真实磁盘写入后重新创建 AuditJournal，确认归档摘要计数及原 unknown 状态保留，详情仍含原操作 ID；中文组件不显示执行成功。TypeScript、ESLint 和汉化检查通过（缺失键 0）。日志 .cache/archive-history-before.log / archive-history-after.log / archive-history-tsc.log / archive-history-lint.log / archive-history-locales.log。

额外实际数据验证：使用当前 AuditHistoryReader 读取 277 的真实桌面 profile 磁盘分片，automatic / collaborative 两个 task.archived 均返回 count=1、status=cancelled，详情保留原 unknown 操作 ID。结果 .cache/archive-history-native-read.json；未重新执行任务或修改审计分片。

边界：中文摘要已有组件验证，当前桌面目录包尚未重建以包含此摘要，不能将 277 截图称为本轮新摘要的实机截图。F08/R05 整体未全部验收，计数仍为 35/79。未提交、推送、打标签或触发 Actions。

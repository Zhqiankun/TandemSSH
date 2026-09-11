# 执行历史的脱敏命令摘要

2026-09-12。历史列表此前只显示program，参数只能在原始详情中查看，无法直接辨认常见操作。现在新增可选commandPreview/commandTruncated：后端先对结构化action脱敏，确认program/args类型与参数数量，再生成引用正确的展示文本并限制512字符。截短不切断UTF-16高代理项；界面明确提示摘要已截短并可查看详情。旧记录缺少args时保留原program回退，不补造空参数。

为保持实时工作台与历史显示一致，将原ui command-plan中的纯displayCommand移动至domain/commands/display-command.ts，UI原入口继续重导出，backend审计投影直接依赖domain。该模块只负责结构化命令的字面量POSIX展示，无UI/API/后端依赖，不授权、不执行；现有round-trip测试验证输出格式未改变。

三文件34项通过：实际JSONL写入/查询验证空格、命令替换字样、单引号边界、password参数脱敏、长Unicode参数截短和缺参数旧记录；真实历史弹窗组件显示参数、截短提示及旧记录回退。ESLint和中文缺失键检查通过。未改写历史文件，没有扩大默认保存内容；摘要仍来自已有脱敏记录。

本轮完善R05/F08的命令可辨认性，不作为整个项目验收完成声明。新版本桌面打包与公开发布仍按既有Actions流程另行验证。
最终 tsc -b 类型检查通过。

后续汉化补充（alpha.7标签之后）：TaskHistory的时间格式改用当前应用语言，而不是系统默认locale。现有历史页面/摘要9项测试通过，局部ESLint通过；未为这处低风险格式修复新增测试。

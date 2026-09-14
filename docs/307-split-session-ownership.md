# 分屏恢复的唯一会话归属

2026-09-13，继续 F03/B03 工作区恢复验证。

问题：assignTabsToSplit 只修改终端 parentSplitTabId，不同步其他分屏的 paneTabIds。恢复两个重叠配置时，后一个分屏取得终端归属，前一个分屏却仍引用相同终端；同一配置重复引用也未去重。输入数组超过六个槽位时，超出配置范围的终端仍可能被隐藏为分屏成员。

责任和契约：splitTabUtils 负责纯布局状态转换，调用方为 AppShell 布局更新和 restoreSplitTabs；只依赖 UI 类型，不依赖终端内部实现，不操作 SSH 连接。assignTabsToSplit 现在在同一次转换内更新目标窗格配置、终端归属及其他分屏中被移走的引用。保留既有“后分配的归属生效”语义，同时清除旧布局的对应引用。

有效成员限定为存在且非 split-screen 的标签；每个终端仅保留第一个槽位引用；最多六槽，不将超出的标签隐藏为成员。无有效目标分屏时返回原状态。操作保持不可变，旧输入布局不改写。没有新增共享抽象或后端接口。

证据：新增两项先复现失败（原有三项通过）；修复后连同 SplitView、workspaceUtils 和 workspaces-api 共 4 文件 44 项通过。覆盖重叠配置恢复、重复槽位、关闭后独立标签、再次序列化、缺失/嵌套分屏引用、六槽边界和原输入不变。日志 .cache/split-ownership-before.log、split-ownership-after.log。

本轮是实际状态转换与序列化测试，不是重启桌面的端到端恢复证明。306 的双 SSH 实机报告发生于本改动之前，不据此宣称新状态修复已通过实机。F03/B03 仍未完成，整体 44/79；未推送 Git 或触发 Actions。

补充检查：TypeScript 和 ESLint 均退出 0，证据为 .cache/split-ownership-tsc.log、split-ownership-lint.log。

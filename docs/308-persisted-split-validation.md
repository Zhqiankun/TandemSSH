# 持久化分屏布局的运行时校验

2026-09-13，继续 F03/B03。AppShell 从 localStorage 解析 termix_splitTabs 后通过 React 状态更新调用 restoreSplitTabs；入口原有 TypeScript 断言不能验证 JSON，损坏记录会在 map/尺寸复制时抛错，外层同步 try 也不能可靠捕获延后的状态更新异常。

restoreSplitTabs 的持久化入参改为 unknown，内部逐项验证，非数组保留原标签。记录要求有效实例 ID、字符串标题、合法模式、字符串或 null 窗格引用，以及符合该模式行列数量、有限正百分比且合计约 100 的尺寸。无效记录跳过，继续恢复有效邻居；重复 ID 或实例身份不生成重复 React 标签。七种预设模式均有兼容性测试。

边界：校验是 splitTabUtils 内部持久化数据边界，不新增公共工具模块、不修改存储格式或 SSH 接口。有效配置继续按 307 的唯一归属规则处理；未修改旧 singleton 布局迁移入口。损坏项不自动修复，既有保存逻辑可能在后续状态持久化时略去未恢复项。

验证：新增损坏邻居与非数组测试修复前均失败；修复后追加七种预设布局恢复，与分屏、工作区和 API 相关 4 文件 53 项全部通过。TypeScript、ESLint 退出 0。日志 .cache/split-restore-before.log、split-restore-final.log、split-restore-tsc.log、split-restore-lint.log。

本轮验证运行时恢复函数和有效布局兼容性，尚未重新打包执行桌面重启恢复。F03/B03 保持未完成，整体 44/79，未推送或触发 Actions。

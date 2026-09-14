# 终端历史的 Unicode 与主机生命周期

2026-09-14，继续F03历史功能。定位实际Terminal.tsx使用的useCommandTracker，而非未引用的旧useCommandHistory Hook。

## 修复

原输入跟踪器只追加ASCII 32–126，中文/emoji被丢弃，且缓冲区在hostId或enabled改变后继续保留。现按Unicode码点遍历普通字符，保留中文与emoji，退格移除完整码点；C0/C1控制字符仍不作为普通历史文本。useLayoutEffect在主机/启用状态变化后、界面接收新输入前重置命令与转义序列状态。

改动仅在终端业务Hook内，无新共享模块、数据库或API变更。调用方仍接收既有返回值。此处记录输入提交，不把客户端跟踪当成远端命令执行成功证明。

## 验证

新增5个用例修复前4失败/1通过；修复后通过。补齐分段代理对、Ctrl+C取消及敏感模式过滤，最终7项通过。涵盖中文/emoji原样提交、退格不留半个代理对、主机切换不混合旧输入、关闭再启用不保留旧缓冲/转义状态、跨回调ANSI与Unicode处理。日志.cache/command-tracker-before.log、command-tracker-after.log。

未宣称实现完整Shell行编辑器、所有TUI输入重建或所有秘密检测，也未将Hook测试当成实际Windows输入法候选窗口验收。完整终端历史与状态仍需实机复核，整体67/79。

未重打包该修复、未推送Git、未触发Actions，公开安装包未更新。
最终 `tsc -b` 与修改文件 ESLint 均 exit 0。日志 `.cache/command-tracker-types.log`、`command-tracker-lint.log`。

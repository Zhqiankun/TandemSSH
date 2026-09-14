# 终端系统剪贴板验证受阻与 tmux 中文分包修复

2026-09-14。继续 F03/B03 终端验收，不扩大已完成范围。

## 真实剪贴板尝试

使用当前 Windows 目录包、独立用户数据目录与本机 SSH 测试服务。测试计划覆盖真实选择复制、Ctrl+Shift+C/V、单行发送、多行预览取消/确认、断线后拒绝旧预览，并仅在剪贴板仍归测试所有时恢复原纯文本。

报告：.cache/desktop-observation-report-7e337db7-34fd-4e37-a632-13ca041d4a2f/desktop-failure.json。客户端身份验证已通过；剪贴板检查发现非纯文本格式，修改前保护中止。没有读取或记录原文本，没有执行复制粘贴阶段，不能计为系统剪贴板验收通过。失败后结束了测试拥有的进程树；后续检查 PID 39104 不存在，30001–30012 无监听。属于强制失败清理，不是正常退出通过。

## 已修复缺陷及边界

backend/hosts/tmux/helper.ts 的 execCommand 原先每包 Buffer.toString("utf-8")，中文或 emoji 跨 SSH 数据包时会丢失字符，影响 detectTmux 返回的会话名称和远端错误信息。

修复仅在 tmux 远端命令适配器内：stdout/stderr 各持有一个 StringDecoder，跨包保留未完整字符，关闭时各自 flush。返回 Promise<string>、错误规则和命令路径不变。没有新增共享抽象、依赖层反转、数据库迁移或前端协议变更。

测试模拟每字节分包，验证完整中文会话名、交错 stdout/stderr、中文错误。修复前新增 3 项全部失败；修复后 tmux 与终端编码相关 4 文件 30 项通过、1 项 Windows 平台跳过（真实 /bin/sh 引号解析）。类型检查 tsc -b 与改动文件 ESLint 均 exit 0。日志 .cache/tmux-utf8-before.log、tmux-utf8-after.log、tmux-utf8-types.log、tmux-utf8-lint.log。

## 剩余

此修复不证明 GB18030/Big5/Shift-JIS 终端与 tmux -u 的交互兼容性；该项仍待处理。真实系统剪贴板、操作系统输入法候选窗口等剩余验收仍保留。整体 67/79，不关闭 F03/B03。

本轮未重新打包、未推送 Git、未触发 Actions；当前本地目录包不包含本次源码修复，公开安装包仍未更新。

# 输入接受确认与历史一致性

2026-09-14，完成438发现的旧编码拒绝输入仍进入历史问题。

## 复现

当前修复前目录包在Big5终端输入繁體中文，再输入被拒绝的emoji、OK与回车。SSH字节证明emoji未发送，但实际历史为繁體中文😀OK。报告.cache/desktop-observation-report-af93b2a9-1ee5-4668-aba2-07aa04bb2b8a/rejected-input-history.json，失败日志.cache/rejected-history-before.log。

## 协议与职责

新增backend/hosts/terminal/input-receipt.ts作为普通人工输入的转发边界。sendHumanInput成功同步通过权限、编码预检并交给现有SSH流后，向同一个发起WebSocket发送terminal.input.accepted，包含sessionId及已接受输入。拒绝沿用collaboration.error，不发送接受确认。它仅代表传输接受，绝非远端执行成功或落盘保证；不广播其他参与者输入。

各会话握手增加inputReceipts能力标志。前端对匹配当前sessionId的确认才调用持久化历史跟踪器；即时本地行编辑使用独立persist:false跟踪器，保留原有本地快捷处理速度。后端拒绝字符不再被持久化，也不会提前更新基于历史的建议。未声明能力的旧后端维持原兼容路径，此修复的确认保证针对支持新能力的当前客户端/后端组合。

数据依赖为SSH输入适配器→现有SessionManager/SessionControl，前端仅消费WebSocket契约；无数据库迁移，无通用utils抽象。确认丢失不会自动重放输入；本轮不保证断线最后一条未收到确认的输入必然出现在历史。

## 测试与实际结果

15项相关测试通过，涵盖真实Big5编码预检、失败无确认、有效字符顺序、本地即时跟踪与持久化分离，以及原Unicode/生命周期用例。首轮预检夹具未像生产SessionManager一样把编码错误包装为ControlError，得到RESULT_UNKNOWN，已按实际契约修正夹具后重测。原错误契约未放宽。类型、ESLint、完整build及目录打包exit0。

最终真实Windows报告.cache/desktop-observation-report-be5853bb-3bd4-4695-8843-6025531655ae。big5-good-accepted-history.json与sjis-good-accepted-history.json已读取，历史分别只有繁體中文OK、日本語OK。测试同时保留旧编码实际SSH字节、emoji拒绝中文提示和继续输入OK的断言。客户端cleanExit=true、父runner exit0、30001–30012已释放，日志未出现测试认证秘密。

日志.cache/input-receipt-tests.log、input-receipt-types.log、input-receipt-lint.log、input-receipt-build.log、input-receipt-package.log、accepted-history-desktop.log。

本轮使用受控ssh2 shell，不声称真实Linux命令执行或所有Shell行编辑/TUI历史重建已经完成。F03其余历史界面/状态及其他原始要求仍保留，整体67/79。未推送Git、未触发Actions，公开安装包未更新。

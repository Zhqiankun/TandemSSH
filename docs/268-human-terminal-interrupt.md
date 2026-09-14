# 独立的人工 Ctrl+C 入口

2026-09-13，补齐 02-experience/F04 的发送中断操作。

## 行为与契约

协作控制栏新增“发送 Ctrl+C”，与立即接管、暂停任务和取消任务分别呈现。提示明确：先接管当前会话，再发送一次 Ctrl+C，远端程序是否停止仍需核对。控制栏支持换行。

POST /tandem/sessions/:id/interrupt 继承可信界面认证，只接受 generation、controlEpoch 两个严格字段。TaskRuntime.interruptSession 要求 human 主体、会话所属用户及当前控制版本；旧版本和已关闭会话拒绝。

使用已有 SessionControl 先推进控制 epoch，再通过 humanInput 写入固定 Uint8Array.of(3)。即使会话原本由人工持有，也推进版本，以拒绝同一旧快照重放。接口不接受任意文本、命令或自选控制字符，MCP 工具目录未扩展。

请求通过后返回 requested 与控制快照，表示字节已交给现有传输，不表示远端进程退出或回滚。尽力记录 session.interrupt_requested；不以日志写入成功作为人工中断的前置条件。

## 文件责任

运行时负责身份/版本及固定写入；HTTP 层负责请求校验；API 模块负责适配；工作台复用既有控制操作互斥和会话生命周期；面板只编排按钮。中英文、繁体中文和其他语言英文回退及时间线事件名已补齐。

没有新增任意输入通道、共享模块或反向依赖。

## 验证

运行时与中文面板共 2 文件、61 项通过。新增场景覆盖：人工专属、其他用户/MCP 拒绝、只发送一个 03 字节、旧 epoch/重连 generation 拒绝、活动任务暂停但不取消、不派发后续步骤，以及界面调用独立中断 API 而非 pause/cancel。

初次组件测试中使用 Node Buffer 与 jsdom 的 Uint8Array realm 不一致；按端口约定改为原生 Uint8Array 后通过，未弱化输入验证。

实际 HTTP、最新桌面与真实远端进程响应仍待验收；F04 不标记完成。当前目录包不包含本轮中断功能。未提交、推送或发布。

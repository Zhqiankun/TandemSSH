# 桌面断线重连与 SSH 连接验收归并

2026-09-13，F02/B02。当前 Windows 目录包连接隔离 Alpine 3.24.1，经本地 TCP 代理转发；代理只允许本轮 VM 的固定目标地址和端口。

## 真实桌面断线场景

automatic：授权 sleep 20 → touch 标记文件的任务，等待第一步实际运行后切断代理连接。collaborative：授权 touch 标记文件，等待单次审批后切断连接。两种情况分别通过实际“重新连接”按钮建立新 SSH 连接。

- 断线前任务保持停止，重新连接后的控制者为人工，连接身份/代次不复用旧控制权。
- automatic 的断线前授权快照被 404 SESSION_NOT_FOUND 拒绝；collaborative 的旧 operationId/digest 批准被 400 STALE_APPROVAL 拒绝。
- 旧任务操作数量未增加，独立直接 SFTP 查询确认两个后续标记文件不存在。
- 在重连后的前台终端手工执行 printf，收到真实 Linux 的 RECONNECTED_automatic / RECONNECTED_collaborative 输出。

成功报告 `.cache/desktop-observation-report-8970dbba-1170-4565-926c-03081f08b593/reconnect-result.json`，已查看 reconnected-collaborative.png。任务创建/授权通过真实 HTTP，重连和人工输入通过实际桌面；本轮不调用模型，不把模式名称当作模型推理验收。此前自动/协作模型与 MCP 组合另有原条目证据。

首轮 b4bc54ae-2515-4ff9-acc2-d8c89b19d1f7 已成功重连并拒绝旧授权，但脚本仅接受 400，因正确的 404 SESSION_NOT_FOUND 判失败。按路由对已销毁会话的实际契约修正为接受明确的旧会话/旧控制权错误后，重新执行两个完整场景通过；未修改生产授权逻辑。

## 原始连接标准对照

| 要求 | 证据 |
| --- | --- |
| 密码、带口令私钥 | 285 的 Linux 正确连接，294–296 的前置校验、实际桌面正确/失败认证、停止重试与安全提示 |
| SSH agent | 53 的 Windows 临时命名管道 agent 与终端/SFTP/监控登录，297 的当前身份列举/签名约束和真实 agent 协议回归 |
| keyboard-interactive | 60–63 的终端、文件、监控、跳板认证；64 的实际 Windows 多轮认证、取消、人工重连及旧回复拒绝 |
| 基础单跳 | 62/64 的限定目标转发、分别核对跳板与目标指纹，以及自动/协作实际 Linux PTY 组合 |
| 主机指纹核验 | 23/293 的密钥更换认证前阻断、旧记录不自动改写、人工更新后新连接生效 |
| 超时与保活 | 298 的定时器边界、299 的真实报文/关闭/静默 TCP 网络超时检测 |
| 重连与旧授权 | 本轮两模式真实 TCP 断线、人工重连、旧批准拒绝和禁止后续文件副作用 |

当前组合回归：认证协议、agent、交互、共享交互 HTTP、跳板、真实指纹握手、保活等 10 文件 65 项全部通过，无跳过，日志 .cache/ssh-connection-final-validation.log。共享交互认证包含回复前权限复查、撤销后移除提示、异步授权期间取消与旧连接隔离。该证据不扩展为所有第三方 agent 产品或所有共享/RBAC 场景。

按 F02/B02 原始范围标记 verified，总计 44/79。原始终端、文件工作台、隧道全集与其他条目保持各自验收范围，不因连接功能通过被一并标记完成。

应用正常退出并释放端口，代理与测试文件根目录清理；VM 按准确 manifest 停止，返回 forced=true，启动器退出码 0，不能称为操作系统正常关机。构建日志 .cache/reconnect-native-build.log / reconnect-native-package.log，运行日志 .cache/reconnect-native-desktop.log。未提交、推送、打标签或触发 Actions。

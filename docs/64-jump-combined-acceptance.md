# 跳板机与 MCP、监控的组合验收

状态：当前实现已通过下述真实 Windows 组合场景；不能据此宣称完整基础功能或整个项目已验收。

## 环境与边界

代码基线为 72ee56c。测试使用当前 Windows 目录包、独立用户目录，以及固定 Alpine 3.24.1 QEMU 实验机。本次 Linux 实验编号 0be85de8-c3cd-4859-bc32-de29c571a182，SSH/QMP 仅回环可达，无宿主共享。

连接路径为：Windows 客户端 → 需要人工验证码的 SSH 跳板机 → 需要人工多轮认证的测试 SSH 入口 → 实际 Alpine OpenSSH PTY 或采样命令。每个转发入口只能连接指定的本次测试目标端口。该场景验证多层认证与实际 Linux 行为，不代表 Linux PAM MFA 配置。MCP 使用本次测试配对，不改日常 Codex 配置，不调用付费模型；以下两种模式指 MCP 驱动的真实任务执行模式，不声称模型推理正确性已由该脚本验证。

## 自动执行与人机协作

独立核对跳板机与目标机指纹，分别回答认证提示。目标机登录覆盖密码原始空白、空字符串回复、验证码错误后的新提示。跳板问题经共享人工队列回答，目标终端问题经本次终端连接回答，答案未写入 PTY。

MCP 分别创建 automatic、collaborative 任务，在中文界面授权后执行 export、printenv 和 touch。检查同一 Linux Shell 中变量可见，实际文件通过独立 SFTP stat 核对。协作模式在界面逐条批准；自动模式执行期间人工接管，后续 MCP 写入被拒绝，独立 SFTP 检查确认未生成禁止写入的文件。再次授权后任务可结束。

另开连接取消目标机登录，连接关闭且没有发送额外答案或打开 Shell。新连接中注入上一连接的旧提示 ID，服务器没有收到旧答案；新提示可正常完成登录。三个跳板连接完成认证和限定端口转发，无越界转发尝试。

证据：.cache/desktop-observation-report-92ece3ff-4ad2-4582-a918-c5f2d1e68fe3/keyboard-auth-result.json；modes 为 automatic、collaborative，interactiveJump、authDataNotSentToPty、cancelClosesConnection、staleReplyBlocked 均为 true。截图包括 jump-automatic-collaborative-prompt.png、keyboard-automatic-completed.png、keyboard-collaborative-completed.png；日志 .cache/jump-dual-mode-desktop.log。结果中的关闭数量在应用退出前采集，不能将该瞬时值当作最终资源释放数量。

## 监控与跳板机

使用同一交互跳板实现，Windows 监控页面分别完成跳板和目标认证，然后从真实 Linux 读取内存及运行时间。卡片实际显示值，内存总量与独立读取基线核对。

取消目标机认证后，无额外回复，观察 6.5 秒无新认证；人工重连使用新提示，旧 ID 被拒绝，指标卡片恢复。另开监控连接，在跳板验证码阶段取消：跳板连接关闭，目标认证答案未发送，同样观察 6.5 秒无新认证。

证据：.cache/desktop-observation-report-f27a7c18-816e-4aba-8071-e9bbd21b5de3/monitor-auth-result.json；interactiveJump、jumpCancellation、cardsVisible、cancelNoRetry、manualRetry、oldIdRefused 均为 true。共三次跳板认证、三次限定端口转发；包括额外被取消的跳板连接在内，结果采集时四次关闭。截图 monitoring-jump-prompt.png、monitoring-jump-cancelled.png、monitor-auth-reconnected.png；日志 .cache/monitor-jump-desktop.log。

## 尚未由本次验证覆盖

压力和接管延迟另行测量。认证后的长期断线恢复、完整共享权限撤销、各种私钥/agent/代理组合、基础文件和隧道全集、历史数据升级、公开发行及全量许可和中文审计仍保留原范围。本文引用的 .cache 证据为本机验收产物，不随源码发布。
本次所有实验机和客户端已正常退出，Linux 管理进程退出码 0，相关端口释放。三个成功场景的独立用户目录各扫描 7 个配置、审计和日志文件，没有检出测试密码/验证码的 UTF-8 或 UTF-16 明文；未解密数据库。检查记录 .cache/combined-auth-privacy-check.json。持续输出和接管延迟的结果见 [终端压力测量](65-terminal-pressure.md)。

# 终端持续输出与接管测量

状态：本次参考机的初始持续输出及接管延迟用例已通过；完整队列上限、长期资源增长和跨机器性能仍未由该用例证明。

## 环境与测量口径

参考机为 Intel Core i7-9700，8 核/8 逻辑处理器，物理内存 34294444032 字节，Windows 11 专业版 10.0.22000。使用 Electron 43.2.0 Windows 目录包、独立用户目录、交互验证码跳板和真实 Alpine Shell；无生产主机、付费模型或日常 Codex 配置修改。

先进行 20 次空闲接管，再由本次测试 SSH 入口按 1 MiB/s 注入固定 ASCII 输出，目标 30 MiB/30 秒，有背压处理和总时限。该负载用于测量终端传输和显示，不声称是 Linux 应用自然产生的日志。负载期间执行 20 次接管，每次在中文界面重新授权后再测下一次。

延迟起点是在同一渲染器执行按钮 click，终点为后端状态更新后 DOM 显示 paused-human，采用 performance.now 和 nearest-rank p95。该数字不包含操作系统输入队列、测试控制连接排队或已送出远端动作的生效时间。页面 20 ms 定时器的延迟另行记录。

每次接管后尝试通过 MCP 写入，必须被拒绝；最终独立 SFTP 检查 Linux 上没有禁止写入的文件。CPU/内存来自本次 app.getAppMetrics 暴露的 Browser、GPU、Utility、Tab 进程，不包含实验机或未列入该接口的进程。CPU 为相邻调用间平均值，内存原始单位为 KiB；工作集求和可能重复计入共享页面，不能当作整机独占内存。[Electron CPUUsage](https://www.electronjs.org/docs/latest/api/structures/cpu-usage)、[MemoryInfo](https://www.electronjs.org/docs/latest/api/structures/memory-info)说明了这些计数口径。

## 失败、定位和修复

首次运行在持续输出期间中断。服务器出现 WebSocket pong timeout - terminating zombie connection，随后终端重连并重新要求跳板验证码。任务保留 paused-human，没有在接管后放行自动写入。证据为 .cache/desktop-observation-report-41d98bc2-03c0-403d-baa1-8f03126a0d89；该轮没有完成全部样本，不能用于性能达标结论。

空闲对照 .cache/desktop-observation-report-539fd069-6803-40e5-b5b7-272fc02d5301 持续 65 秒，发送/收到两次应用心跳，连接未关闭。没有修改心跳协议或延长超时。

单独测量发现终端语法高亮中的 Shell 提示符正则在普通字母日志上重复回溯，处理 128 KiB 压力样本约 500.29 ms。terminal-syntax-highlighter.ts 增加必要条件检查：文本不含任何提示符结束字符时直接跳过提示符正则；仍保留后续日志/路径/数字高亮，也不修改原始输出、关闭高亮或丢弃数据。相同样本降为约 5.97 ms，输出完全一致；已有及新增高亮、控制序列和自动回复测试共 80 项通过。

优化后的中间运行完成了 20 次接管且未断连，但验收脚本错误地把异步读数 Promise 与字节数比较，导致完成条件永远为 false。诊断 .cache/desktop-observation-report-3bb9acc7-3f0d-482a-9c72-3fabc78f89e0/pressure-drain-final.json 显示实际接收量已大于负载量。这是测试脚本问题，不是产品丢失输出；修复等待语义后重新完成全流程。

## 最终结果

最终报告：.cache/desktop-observation-report-72d7e194-67c9-4b7e-9598-440314395e42/terminal-pressure-result.json；汇总 .cache/terminal-pressure-summary.json，截图 terminal-pressure-completed.png。

| 指标 | 实测值 |
| --- | --- |
| 注入负载 | 31457280 字节，用时 30001.04 ms |
| 浏览器收到的输出 | 31469802 字节，包含授权产生的额外控制输出 |
| 空闲接管 | 20 次，p95 14.0 ms |
| 持续输出下接管 | 20 次，p95 17.4 ms；低于本机 300 ms 测量目标 |
| 页面事件延迟 | 1500 个样本，p95 3.4 ms，最大 18.5 ms |
| 采样 CPU 使用率之和最大值 | 约 11.07%，为列出的应用进程区间平均值之和 |
| 工作集之和 | 基线 554.27 MiB，采样最大 673.33 MiB |
| 私有内存之和 | 基线 375.10 MiB，采样最大 494.10 MiB |
| 接管后自动写入 | 20 次均拒绝，独立核对目标文件不存在 |

接收总字节数包含授权控制输出，不作为每个负载字节的哈希一致性证明。上述样本不等于长期内存增长测试，也不能推广为所有机器、所有终端内容或所有网络环境的性能承诺。高亮热点修复及本次参考用例不替代输出队列有界性专项。

本次客户端正常退出；Linux 实验机 0be85de8-c3cd-4859-bc32-de29c571a182 正常关闭，管理进程退出码 0，相关端口释放。三个成功组合/压力用户目录各扫描 7 个配置、审计和日志文件，未发现测试密码或验证码的 UTF-8/UTF-16 明文，未解密数据库；记录为 .cache/combined-auth-privacy-check.json。

日志：.cache/highlight-pressure-before.log、highlight-pressure-after.log、terminal-pressure-targeted.log、terminal-pressure-lint.log、terminal-pressure-build.log、terminal-pressure-package.log、terminal-pressure-verified.log。最终完整应用回归 491 个测试文件通过、1 个跳过；3498 项通过、12 项跳过，约 269 秒。命令为 vitest run --exclude src/backend/tests/collaboration/pty-integration.test.ts --maxWorkers=2，独立 PTY 门禁不在该结果内。最终 Windows 包的 13 项原生依赖探测和 3 项打包 MCP 测试通过，隔离 Codex 可发现 38 个工具；中文翻译键缺失为 0。日志为 .cache/terminal-pressure-regression.log、terminal-pressure-native-probe.log、terminal-pressure-package-mcp.log。

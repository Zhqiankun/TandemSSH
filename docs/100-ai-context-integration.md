# AI 上下文集成回归与真实 SSH 验收准备

2026-09-12。

新增终端上下文后，完整 backend/tests/ai 21 文件 / 147 项通过，包括自动和协作模式的任务恢复、目录、文件、传输、保存流程、模型响应预算和出口限制。实际结果 .cache/ai-context-integration-results.json。

新增 linux/ai-handback-acceptance.test.ts，使用真实 SSH PTY、TaskRuntime 和 AiTaskCoordinator，模型为可控响应夹具：等待任务获得授权后保持旧响应；人工同 Shell 输出标记和秘密字段；重新交还后验证下一模型请求包含标记并脱敏；协作模式需审批新 pwd；最后验证 pwd 成功且旧 printf 没有进入终端。仅操作 linuxFixture 自有目录，关闭时释放协调器和 SSH。

本轮实机未能运行：VM f6c29e16-8424-4d5a-9edb-902671de9577 的 serial.log 记录 Kernel panic - not syncing: IO-APIC + timer doesn't work。发生在内核启动期间，未收到 vmReady / SSH 握手。不能将其解释为产品 SSH 失败或验收通过。证据 .cache/ai-handback-linux-launch.log 与 .cache/linux-lab/runs/f6c29e16-8424-4d5a-9edb-902671de9577/serial.log。

已通过核对 QMP 实例身份停止该 VM；因内核崩溃无法正常关机，停止器报告 forced=true，QEMU vmExited code=0，启动器以 1 退出。没有保留运行中的 VM。新增测试 ESLint 通过，未设置实验清单时两项明确 skipped，不算通过。真实 SSH 执行及 Windows 桌面观察仍待完成。
`npm run type-check` 已通过。

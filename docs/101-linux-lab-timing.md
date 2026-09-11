# Linux 实验环境计时恢复选项

2026-09-12，真实 AI 交还验收的准备环境连续两次在内核启动阶段发生 IO-APIC + timer doesn't work：f6c29e16-8424-4d5a-9edb-902671de9577、7fea0366-2e8e-49b6-959b-cefe1f3d778f。两台均已经 QMP 身份核对后停止，未进入 SSH。

启动器新增显式环境变量 TANDEM_LINUX_ICOUNT=1，设置 tcg,thread=single 及 -icount shift=auto；默认仍为既有 tcg,thread=multi。新 manifest 记录 timing，便于复现。镜像、指纹验证、非 root 用户、只监听回环地址和自有目录清理边界不变。

依据 [QEMU 指令计时文档](https://www.qemu.org/docs/master/devel/tcg-icount.html)，icount 与多线程 TCG 不兼容，故必须同时切换单线程。这是实验环境兼容选项，不是产品 SSH 修改，也不宣称确定修复所有 APIC 问题。

本轮以新选项启动 3b23fb77-ca6d-4817-a910-a48888b359c3，串口显示已越过原崩溃点并挂载根文件系统。随后收到 vmReady，真实 SSH 确认为 Linux / UID 1000 / Alpine 3.24.1。证据 .cache/ai-handback-linux-icount.log 与该实例 serial.log。启动脚本 node --check 通过。

真实 ai-handback-acceptance.test.ts 自动和协作两项均通过，共 5.968 秒；结果 .cache/ai-handback-linux-results.json。人工标记进入下一次模型请求、秘密脱敏、旧命令不执行、唯一新 pwd 成功并返回实验目录。这使用真实远端 PTY 与受控模型响应，尚不等于桌面 UI 验收。
测试后停止器等待正常关机未在 15 秒内结束，核对 QMP 身份后 quit，forced=true；启动进程最终 exit=0。真实测试已在关闭前完成；不将此描述为正常关机验证。

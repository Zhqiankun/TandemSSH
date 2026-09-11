# Windows / Linux 双模式 AI 交还验收

2026-09-12，源码 3ef2061 的本地开发目录包（元数据仍为 alpha.4；不是公开 alpha.4 安装包）。构建与原生模块探针通过，发布仍由 GitHub Actions 负责，本轮未上传包。

## 实际过程

运行自有 Electron 实例、新临时用户目录，以及隔离 Alpine 3.24.1 SSH VM。主机和 AI 任务通过实例内 API 建立；MCP stdio 打开共享 SSH 会话，中文界面核对指纹并信任。通过界面选择任务、设置范围、授权、立即接管、交还；通过 CDP 键盘输入操作实际 xterm，而非直接写 SSH 通道。协作模式的新 pwd 另点一次批准。

本机 OpenAI 兼容服务保持第二次模型请求，人工接管时被取消。第三次请求必须含实际人工输出 DESKTOP_HANDOFF_<mode>，不得含已知测试秘密，且必须含 untrusted-terminal-output 标记；随后真实 pwd 成功才结束。模型为确定性夹具，不调用付费模型，不证明推理质量。

自动和协作两模式均完成：生产 SessionManager 输出缓冲 → TaskRuntime 权限校验与脱敏 → AI runner → HTTP 模型请求链已覆盖。每个任务只有新 pwd 一项操作成功；界面已完成状态显式等待并截图，应用正常退出。已查看最终协作截图，中文已完成、控制权人工持有与模型完成消息均可见。

证据目录 .cache/desktop-observation-report-ae0aa784-c054-45f6-8a0a-165cc0dda4b1：ai-handback-desktop-result.json、model-checks.jsonl、ai-handback-automatic.png、ai-handback-collaborative.png、桌面退出记录。运行脚本 .cache/run-ai-handback-desktop.cjs；日志 .cache/ai-handback-desktop-final.log。

## 复测记录与结论

首轮 ff9d8993 在任务选择超时：脚本漏点“协作执行”面板，后台任务正常待授权。修正后 63f57b68 双模式通过，但截图早于 UI 完成刷新；补上界面完成断言后得到上述最终报告。未把观察器问题记录成产品缺陷，也未以后台状态替代 UI 证据。

结合 [98](98-handback-context-review.md) 的三个时点旧批准拒绝回归、[99](99-ai-terminal-context.md) 的权限/脱敏/长度测试及 [101](101-linux-lab-timing.md) 的真实 SSH 双模式结果，A08 可以按原文标记 verified。该结论仅限此验收条目，不扩展为全部产品完成；尚未发布的开发代码不会自动进入旧安装包。
测试 VM f794f130-11cb-4a3e-8a23-6ed6b008621a 已停止：QMP 等待关机超时后身份核对 quit，forced=true，启动进程 exit=0。应用自身为正常退出；不混淆两者。

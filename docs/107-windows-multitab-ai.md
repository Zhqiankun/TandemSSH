# Windows 双标签 AI 派发隔离验收

2026-09-12，本地开发包包含 alpha.5 源码及后续测试提交，未替代 Actions 公开发布。

建立两个主机记录连接同一自有 Alpine SSH 实例，确认 sessionId 不同，形成 A/B 两个独立 PTY。主机和任务通过实例内 API 准备，实际标签通过标签条点击切换，人工输入由 CDP 键盘进入当前可见 xterm。模型仅使用本机受控 HTTP 服务。

自动模式：A 任务获得界面授权，保持模型第二轮响应；切到 B，人工输出 TAB_B_MANUAL_automatic；释放 A 响应，保持 B 激活至 A 完成。分别读取两个会话输出，A 只有 TAB_A_AI_automatic，B 只有人工标记。协作模式在 B 激活时释放 A 提议，确认 A 尚未写入，切回 A 点“确认执行这一条”，再回 B 等待完成。两种模式均无交叉标记，后续 A 模型请求也没有 B 输出。

最终回到 A 明确等待中文“已完成”。已查看 B 自动截图及 A 协作完成截图。应用正常退出；报告 .cache/desktop-observation-report-9932ddb6-a6d8-4d41-a49d-eb35e1a9012f/multitab-result.json，相关截图 multitab-b-automatic.png、multitab-a-collaborative.png，模型检查 model-checks.jsonl；运行 .cache/run-multitab-desktop.cjs，日志 .cache/multitab-desktop-second.log。

首轮 b83cffa1 超时发生在选择标签：观察器寻找 span，但产品标签标题为 div 直接文本。按实际 group/tab 元素及可见终端命中位置修正后通过，没有为此修改产品。

结合 103 的工作台异步隔离和 104 的界面延迟提交、服务端双会话上下文/命令隔离测试，A03 按原文“切标签时 AI 派发仍绑定原会话，不落到新活动标签”可标记 verified。本次真实环境为同一 SSH 服务器的两个独立会话；不扩展声称所有远端平台已验证。
测试 VM fc7fe301-0435-4005-a5e2-5711553b1fd0 已关闭：等待正常关机期限后 QMP 身份核对 quit，forced=true；启动进程 exit=0。桌面应用本身正常退出。

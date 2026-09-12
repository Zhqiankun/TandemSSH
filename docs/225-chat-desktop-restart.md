# 打包桌面聊天加密保存与重启

## 实测范围

当前开发源码构建本地 `--win --dir --publish=never` 目录包，仅用于验收。独立启动 TandemSSH.exe，核对 PID、可执行路径、数据目录、版本和 renderer URL，使用工作区下独立测试配置。没有更新用户日常数据或上传本地安装包。

报告：`.cache/desktop-observation-report-7654a06b-0399-45a1-89c4-91986af8a3fb`，其中 save/chat-result.json、restore/chat-result.json 与 result.json 为结果。脚本 `.cache/chat-desktop-observer.cjs`、`.cache/run-chat-desktop.cjs`。

## 实际链路

1. 中文桌面首次初始化，在真实后台配置本机 OpenAI-compatible 模拟服务与测试 Key。
2. 普通聊天经过真实 provider adapter、runAgent、工具目录和数据库：模型先调用 list_hosts，再返回中文正文。SSE 只有一个 done，历史保存三条内部助手/工具消息及对应调用 ID。
3. 第二个聊天收到“中断片段”后实际取消 HTTP，真实后台保存 interrupted 记录。
4. 正常退出桌面。验证 db.sqlite.encrypted 的 v2/aes-256-gcm 容器，测试 Key 未以原文出现，未出现普通 db.sqlite 文件。没有读取系统密钥或解密容器。
5. 同配置再次启动：完整历史行与退出前完全一致，中断片段与状态保留。再次聊天，模拟模型实际接收到原 tool_call_id 对应的历史结果。
6. 再次正常退出，后台监听端口释放；模拟服务关闭。两次桌面退出和脚本最终退出码均为 0。

模拟模型共 4 次聊天请求，没有付费模型、真实服务器凭据或日常 Codex 配置变更。

## 发现的实际功能缺口

AiPanel 当前只会刷新正在进行的会话，尚无历史会话选择/重新打开入口。此次通过实际桌面 renderer 调用后台 API完成重启读取，**不是用户通过历史列表点击打开的界面验收**，也没有以截图代替该缺失入口。

下一步需实现历史会话选择、新会话和切换时取消旧流/防止迟到结果覆盖，再进行真实桌面点击验证。R06/F05/F06/A23 保持未完成。目录包版本仍显示 alpha.12，但包含后续开发改动，不能当作已发布 alpha.12 的验证；公开新包仍由 Actions 构建发布。

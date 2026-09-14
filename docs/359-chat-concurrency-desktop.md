# 普通聊天并发限制的当前桌面反馈

2026-09-14，补229尚未完成的打包桌面反馈。没有修改生产代码、模型预算、权限、共享抽象或依赖。

## 实际场景

独立Windows客户端、真实本机后端与本轮创建的OpenAI兼容HTTP/SSE端点，不使用商业模型或真实Key。通过真实API配置独立测试提供商并开启本测试用户AI，重载界面后打开实际聊天面板。

1. 从该用户的真实HTTP入口建立4个不同聊天并把本地模拟模型响应挂起，模拟其他同时活动的客户端请求。随后从实际界面发送，第5路显示“同时进行的聊天过多，请等待其他回复结束后重试。”，模拟模型请求数仍为4。
2. 放行原4路并等待其HTTP流完成（包含后端保存），界面再次发送成功，正常产生第5次模型请求与持久化助手回复。
3. 通过真实HTTP占用当前界面会话，再从该会话界面发送，显示“本会话正在回复，请等待完成或停止后再发送。”，没有额外模型请求。放行占用后，同会话再次发送并持久化成功。
4. 总计7次模型请求，与4路占用、两次成功界面请求及1次同会话占用准确对应；两次拒绝不产生模型调用。没有自动排队或重发。

报告.cache/desktop-observation-report-a04991d8-55d9-4b76-9982-90b805fd401b/chat-concurrency-result.json已读取。截图chat-limit-chinese.png、chat-busy-chinese.png、chat-capacity-recovered.png保留；中文提示以实际DOM断言为证。脚本.cache/run-chat-concurrency.cjs、chat-concurrency-scenario.txt。日志chat-concurrency-native.log；观察器复用了旧启动骨架，其downloadRecoveryDesktop日志字段不是本轮功能名称，应以chatConcurrencyDesktop及具体结果报告为准。

客户端正常退出、后台端口释放、脚本exit0，本地模拟模型服务关闭。后台占用由真实API发起，并非人工打开4个聊天窗口；面向用户的两种拒绝与恢复均通过实际输入框和发送按钮验证。

## 回归与边界

chat-admissions和chat-persistence-order共2文件9项通过，日志.cache/chat-concurrency-regression.log。现有测试另覆盖进程16路、用户4路、旧释放不能解锁新请求、保存结束后才释放。

本轮证明普通聊天的单进程名额及同会话互斥反馈，不把它当成AI执行任务、模型发现、所有上下文或其他资源的统一预算。F05/R06/F06原始范围不随本项完成而整体关闭，后续继续核对模型配置表单及执行任务预算。整体仍54/79；未推送Git或触发Actions。

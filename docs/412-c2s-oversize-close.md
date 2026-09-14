# C2S超限关闭原因保持

2026-09-14，接续411。本地中继原来对WebSocket close只清理连接，服务端1009拒绝时可能保留此前CONNECTED状态；远程中继/探针只给出通用关闭原因。

主进程local/dynamic路径在当前runtime收到1009且尚未关闭时先记录C2S_MESSAGE_TOO_LARGE，再清理；remote路径先发错误状态，并在仍待完成的启动结果中保留该代码。探针也将1009映射到同一代码。普通关闭原因不改变，迟到旧runtime不能覆盖新实例。

中文C2S错误映射同时识别该代码和本地Max payload错误。现有中文超限说明复用，不新增翻译键。

真实WebSocket探针对端在收到测试请求后主动close1009，结果明确失败并保留代码；两种错误形式的中文组件均显示超限原因且无成功提示。与消息边界测试共3文件20项通过。main.cjs语法、tsc -b、修改文件ESLint通过。日志.cache/c2s-oversize-close-tests.log、c2s-oversize-close-types.log、c2s-oversize-close-lint.log。

主进程状态事件尚未打包桌面验证，不把探针测试泛化为所有关闭状态已实测。仍需连接数上限和407之后的整包数据集成，整体65/79。未推送Git或触发Actions。

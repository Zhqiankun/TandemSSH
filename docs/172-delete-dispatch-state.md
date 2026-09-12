# 删除排队时连接变化与结果未知反馈

2026-09-12。永久删除原先只在 HTTP 请求开始检查连接，排队等待通道期间断线或替换会话后仍可能调用 client.exec；通道错误或缺失退出码只返回通用失败文字。

## 修改与责任

operation-routes.ts 使用 execChannel 已有 beforeOpen 契约，在真实通道队列取得执行位置后检查原连接仍在线、会话表中的对象仍为原对象。检查失败返回 DELETE_NOT_DISPATCHED，未调用 client.exec。

通道错误、非明确退出码及无法确定的打开错误返回 DELETE_RESULT_UNKNOWN。既有单次结果结算保持，明确的权限拒绝仍走原提权流程。文件 API 错误允许列表保留这两个状态，普通删除界面显示中英文区别：未派发需重连；结果未知须刷新核对，不能假定回滚。

没有新增模块、共享抽象或依赖。通道队列仍属于 session.ts，路由拥有会话有效性规则；API 只保留受限状态，页面只组织提示。

## 验证证据

三个文件 42 项通过。新增队列测试使用真实 ChannelOpenSerializer 与 execChannel，先持有队列，再发起路由请求，在放行前断开/替换会话，确认 client.exec 零调用、单次 DELETE_NOT_DISPATCHED 响应。既有事件乱序测试增加 DELETE_RESULT_UNKNOWN 断言；实际 deleteSSHItem API 测试确认错误码到达调用者且不携带认证头；批次遇到拒绝停止后续项的测试继续通过。中文缺失键 0，git diff --check 通过。

本轮未重跑真实桌面断线或挂起操作；HTTP 客户端中止、无事件的远端挂起，以及 sudo 队列的同等边界仍需进一步检查。因此不能据本轮结果宣称所有断线/重连场景已完成，B09 保持未全部验证。公开 alpha.8 不包含本轮后续代码。
最终 tsc -b 通过；ESLint 零错误，仅 FileManager 原有 windowId 未使用警告。

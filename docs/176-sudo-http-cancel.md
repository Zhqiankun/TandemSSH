# sudo 删除的 HTTP 中止与取消信号

2026-09-12。在 173/175 基础上补齐 sudo 删除分支的 HTTP 请求中止，避免客户端离开后仍等待或向迟到通道发送密码。

session.ts 的 execWithSudo/execWithSudoBuffer 新增可选 AbortSignal，原调用者不传参数时行为保持。中止在既有单次完成边界结算：尚未派发标为 SUDO_NOT_DISPATCHED，已派发标为 SUDO_RESULT_UNKNOWN；关闭本次通道，清除定时器和 abort 监听。已经完成的操作不被后来中止改写，迟到通道不会收到密码。

operation-routes.ts 的 sudo 分支创建并拥有 AbortController，绑定 req.aborted 和非正常 res.close；中止时结束服务端等待、清理 HTTP 监听、清理本次旧缓存凭据，保留并发设置的新密码。把信号传到辅助执行；迟到成功或失败不再向离开的客户端写响应。正常响应完成不作为中止。

没有新增共享模块、依赖或权限入口。路由拥有 HTTP 生命周期，session.ts 拥有具体通道和定时器，通过可选信号单向传递取消。

## 验证

三个文件 56 项通过。辅助执行测试覆盖 before、queued、negotiating、active、completed 五阶段的取消；确认零派发或零密码发送、通道销毁次数、计时器和 abort 监听清理。路由测试确认请求/响应关闭会中止传入的信号并立即结束等待，即使辅助执行的模拟结果迟到成功也不写 JSON；正常成功只写一次响应且保持密码缓存。

测试使用真实 ChannelOpenSerializer/EventEmitter、受控时间及延迟回调。git diff --check 通过。本轮没有重新执行真实 SSH 断网或桌面关闭；此前实机正常 sudo 验收不代替取消实测。

已派发的远端操作可能已经产生变更，中止通道不等于回滚。回收站移动分支的中止与完整桌面断线/重连仍待继续，B09 保持未全部验证。公开 alpha.8 不包含本轮开发修复。
最终 tsc -b、ESLint 均通过。

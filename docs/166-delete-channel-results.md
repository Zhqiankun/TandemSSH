# 永久删除通道结果与分片权限错误

2026-09-12。核对 sudo 衔接时确认：前端 handleApiError 的 403 分支已保留 response，needsSudo 并未丢失，不做无依据的适配重写。发现后端永久删除有两个实际问题：按单个 stderr chunk 搜索 Permission denied 会遗漏分片文本；error 与 close 先后到达会重复响应，甚至继续触发提权分支。

operation-routes.ts 的单次删除通道增加 settled 状态，首个结果事件结算后忽略后续 error/close。权限判断在 close 时使用已累计 stderr，并要求明确的非零数字退出码；缺失退出码或成功退出不凭错误文本触发 sudo。既有零退出码加 SUCCESS 行的成功契约保持，权限失败后的原有用户提权流程保持。

模块责任仍为文件操作路由处理通道与 HTTP 结果；没有新增模块、共享抽象、外部依赖或用户授权途径。

验证：operation-result-routes 和 file-batch 两文件 25 项通过。新增测试覆盖分片权限拒绝、成功退出时 stderr 含权限文本、缺失退出码、error→close、close→error；每个请求只有一个 execChannel 和一个 JSON 响应。批次计数、会话切换停止等既有测试保留。

首次成功用例未发出实际命令附带的 SUCCESS 行而失败，已修正测试夹具，未放宽生产成功判断。tsc -b 与相关文件 ESLint 通过，git diff --check 通过。

本轮没有实际远端 sudo 删除或桌面提权验收；不能把事件夹具当作完整 B09 实测。发布的 alpha.8 不包含本次后续修复。
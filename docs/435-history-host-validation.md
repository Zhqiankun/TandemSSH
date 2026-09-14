# 历史接口主机编号校验

2026-09-14，继续F03历史范围。发现旧/host/command-history接口和界面实际调用的/terminal/command_history接口都使用parseInt，1abc、1.5、1e3等输入可能被截断映射到其他有效编号；部分删除入口还接受非字符串命令。

## 修复范围与责任

host-command-history-routes.ts负责旧查询/删除入口校验。terminal.ts负责当前界面保存、查询、删除单条、清空历史四入口校验。路径参数仅接受规范正整数字符串，转换后要求安全整数；JSON请求要求正安全整数主机编号及非空字符串命令，缺省body不再直接解构失败。

校验在查询、设置检查和任何历史修改之前完成。用户标识仍取认证上下文，沿用仓储按userId/hostId隔离。旧接口保留命令原文本；当前接口沿用既有trim行为，没有新增数据库迁移、共享抽象或依赖变化。前端command-history-api.ts正常传入number，无需改变界面契约或中文词条。

## 验证

旧接口18项新增测试修复前14失败/4通过。修复后进一步检查实际前端API，避免只修未使用的旧接口；新增当前四入口非法/合法矩阵。最终3文件48项通过，涵盖两组注册路由处理器与原有仓储测试。无效请求断言仓储零调用；合法请求按owner/12转交，旧接口中文命令空格不被改写。日志.cache/history-route-before.log、history-route-final.log。

这是输入校验与仓储回归，不是完整HTTP认证、真实终端命令历史采集或界面状态验收；不因此关闭F03。系统剪贴板已由434单独通过，其他快捷键/输入法/tmux编码等仍保留。总体验收67/79。

未重新打包此修复、未推送Git、未触发Actions，公开安装包未更新。
`tsc -b` 和四个修改文件的 ESLint 均 exit 0，日志 `.cache/history-route-final-types.log`、`history-route-final-lint.log`。

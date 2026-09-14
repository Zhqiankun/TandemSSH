# 保存主机代理关闭后清除旧客户端配置

2026-09-14，继续A22连接配置生命周期核查。terminal/index.ts原来只在resolvedHostData.useSocks5为真时合并代理设置，因此服务端已关闭代理时，客户端携带的旧useSocks5/地址/认证/代理链仍可进入后续连接分支。

新增terminal/saved-host-proxy.ts，负责已解析保存主机的代理设置投影。仅在resolveHost返回真实主机记录后调用；始终覆盖useSocks5及完整代理字段集。关闭时清除旧字段，开启时使用服务端值，缺失的认证/代理链不沿用客户端值。快速连接无服务端记录时不调用此投影。

该模块属于终端连接适配层，纯函数、无网络/数据库依赖，不加入common/shared。index.ts继续负责解析与连接编排，代理传输实现不反向依赖页面。核对Drizzle useSocks5为boolean模式，后续实际连接分支读取的是更新后的hostConfig。

新增3项测试：保存值false/缺失均清除旧认证代理链；保存新无认证代理时不残留旧用户名密码。与host-identity现有测试共2文件16项通过，日志.cache/saved-proxy-tests.log。本轮依据代码分支确认缺口，未在修复前进行真实网络复现；不把纯函数测试称作SSH实机验证。

尚需打包客户端验证禁用代理后的真实重连，以及代理身份变更对已有自动任务的生命周期；本轮不修改已建立的SSH流或任务授权。A22未完全验收，整体60/79。本轮生产修复尚未打包，未推送Git或触发Actions。

最终tsc -b和三处修改文件ESLint通过，日志saved-proxy-types.log、saved-proxy-lint.log。

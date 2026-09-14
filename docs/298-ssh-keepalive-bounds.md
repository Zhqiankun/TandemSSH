# SSH 保活参数的系统定时器边界

2026-09-13，F02/B02 局部修复。

resolveSshKeepalive 原来仅判断 typeof number，会把 NaN/Infinity 或超限毫秒值交给 SSH 客户端，也保留非整数次数。当前 Node 运行实验 setTimeout(2147483648) 返回 1 ms 并报告 TimeoutOverflowWarning，证明超限值不会产生期望的长间隔。

现在对秒转毫秒后的值检查有限性与 32 位定时器上限；不安全值回退到调用方配置的默认间隔。正常正数保持至少 5000 ms，间隔 0 仍关闭保活。次数要求有限且可安全表示，正数向下取整并保持至少 1，显式 0 原样保留；不安全值回退默认次数。没有新增 API、共享模块或依赖变化。

新增 10 项修复前失败；修复后保活、交互认证、共享交互认证、跳板交互联合 4 文件 31 项通过。TypeScript、ESLint、diff 检查通过。日志 .cache/keepalive-bounds-before.log / keepalive-bounds-after.log / node-timer-overflow.log / keepalive-bounds-tsc.log / keepalive-bounds-lint.log。

此轮验证参数边界与既有交互/跳板回归，不声称已经实测网络中断后的桌面恢复或实际 SSH 保活报文。当前包尚未包含本修改，F02/B02继续未完成，42/79不变。未提交、推送、打标签或触发Actions。

# 补齐 AWK、BusyBox 与 Deno 的未知命令分类

2026-09-14，继续 A12。本轮发现 awk/gawk/mawk/nawk、busybox、ash、deno 在精确程序允许规则下被判为 allow，自动模式可以直接派发。

## 范围与依据

GNU Awk 文档说明 system() 可启动程序；BusyBox 官方文档说明多调用二进制及 Shell applet；Deno 官方文档支持 run/eval。故这些程序的名称允许规则不能证明其参数或脚本行为。

- https://www.gnu.org/s/gawk/manual/gawk.html
- https://busybox.net/downloads/BusyBox.html
- https://docs.deno.com/runtime/run/

command-policy.ts 继续独立负责纯策略组合，无远端读取、网络调用、新共享抽象或依赖变化。新增上述七种名称，ash/deno 使用既有锚定版本后缀分类，继承路径、大小写与 exe/com 分类。精确 allow 匹配不变。

普通模式返回 unknown，任务预授权不能直接放行；协作仍需逐条批准。严格模式返回 deny，一次批准不能绕过。沿用现有中文人工审阅和严格模式拒绝原因。人工终端保持既有自由接管行为。

## 验证

在既有双模式网关矩阵加入九个名称（含 deno2.1、busybox.exe），各测试再验证名称与限定路径两种形式。修复前 18 项失败，实际 allow 而期望 unknown；日志 .cache/opaque-families-before.log。

修复后网关、策略组合、AI 任务共 3 文件 188 项通过，包含任务预授权拒绝直接派发、严格模式拒绝、零传输写入及原有相似名称反例。日志 .cache/opaque-families-final.log。

本轮不解析 AWK/JavaScript 内容，也不证明远端同名或改名可执行文件身份；尚未把本轮生产修复重新打入本地目录包。A12 仍 not-fully-verified，整体 60/79。未推送 Git 或触发 Actions，公开安装包不变。

最终 tsc -b 与两处修改文件 ESLint 通过，命令链 exit0；日志 opaque-families-types.log、opaque-families-lint.log。MCP task-permissions/control-contract 两文件回归通过，原始计数见 .cache/opaque-families-mcp.log。

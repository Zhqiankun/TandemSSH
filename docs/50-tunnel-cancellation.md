# 隧道连接中取消与代理兼容

本阶段推进原始 B13 隧道和 B02 连接基础能力：用户在等待连接、指纹确认、代理握手或转发通道时点击取消，旧请求不应继续发送认证、打开监听或覆盖新连接状态。自动执行、人机协作、MCP 与完整 F/B/R/A 目标保持不变。

## 文件责任与依赖

主智能体独立实施和验证。

| 文件 | 职责与依赖 |
| --- | --- |
| `app/src/backend/hosts/tunnel/routes.ts` | 在端点查询与请求排队阶段登记请求取消；取消与停止先检查来源主机连接权限，再使尚未进入 SSH 的请求失效。请求自己的完成回调只清理自己的记录。 |
| `app/src/backend/hosts/tunnel/manager.ts` | 每次连接拥有独立 AbortController，从凭据准备到源/端点握手与监听均使用这一控制器；清理取消旧尝试，迟到的 DNS、握手与转发结果不得恢复连接。 |
| `app/src/backend/hosts/tunnel/ssh-primitives.ts` | 连接接受可选 AbortSignal；信号在 ready 后仍拥有 Client，直到连接关闭。转发和监听等待在取消/关闭时结束，迟到的通道销毁、迟到的监听确认撤销。 |
| `app/src/backend/hosts/tunnel/c2s-relay.ts` | WebSocket 从主机查询开始拥有连接生命周期，关闭时取消 local/remote/dynamic 和连接测试；异常路径回收源连接。 |
| `app/src/backend/utils/proxy-helper.ts` | 现有代理适配增加可选取消信号。收到信号时回收本次代理 socket，取消后不继续下一跳；保留未传信号调用方的原路径。统一编辑器字符串与历史数字代理类型。 |
| `app/src/ui/features/tunnel/TunnelTab.tsx` 与语言资源 | 复用已有取消按钮，将连接状态与转发模式映射到中文/英文词条。 |

依赖保持为 HTTP/桌面转发编排 → 隧道管理与连接原语 → 既有代理和指纹信任服务；没有新增通用共享模块、第二套信任库、MCP 工具或新的命令执行入口。旧远端清理函数、共享活动归属及一般重试规则不做整体重构。超时取消本次准备工作后仍使用既有重试编排。

## 验收范围

- 真实回环 SSH 源和端点等待指纹确认时取消：请求移除、旧批准失效、被取消端零认证、连接关闭、无自动重试；随后明确发起的新连接能够成功。
- 真实 WebSocket 关闭中断 C2S local/remote/dynamic 与连接测试等待的握手，不遗留指纹请求或转发。
- 真实 SOCKS 单代理、SOCKS 链、HTTP 链在握手等待中取消，服务端观察所有相关 socket 关闭；成功路径通过单代理、数字/编辑器字符串 SOCKS 链与混合链传输精确二进制字节。
- 管理器在真实 SOCKS 握手时取消；受控延迟 DNS 返回不能发起 SSH。
- 真实 HTTP 取消与停止路由覆盖端点查找和排队请求；无来源主机连接权限的用户被拒绝，允许的取消不会在查找完成后再次启动连接。
- 对无法确定网络回调顺序的迟到通道/远端监听确认，用可控回调验证销毁与撤销，不把这两项称为真实远端监听测试。

## 已发现的问题与验证记录

新增代理成功路径首先复现编辑器保存 `socks5`、代理库要求数字 `5` 的类型不兼容，错误为 `Invalid SOCKS proxy details were provided`；已在现有适配器归一化 `socks4`/`socks5`，测试保留字符串和数字两种输入。

HTTP 测试首次误用 `{ tunnelConfig: ... }` 包装请求，实际契约为直接配置对象，按现有 API 修正；随后断言误用大写状态，已改用生产 `CONNECTION_STATES` 常量。没有改变 API 或放宽权限断言以通过测试。

阶段组合 33 项通过；增加 HTTP 用例后的完整应用回归与最终桌面验证结果将在下文追加。全项目类型检查通过，全库 lint 为 0 错误/100 项既有警告，静态中文键缺失 0。

当前不能因此声称所有监听范围、全部认证/跳板兼容、共享隧道活动归属、所有转发模式桌面组合或整个产品已验收。正式 Release 渠道、其他原始基础功能和整体自动/协作验收继续。

## 完整应用检查

完整应用回归 **464 文件 / 3345 项通过，5 项按条件跳过**，覆盖新增 HTTP 路由用例。类型检查通过；全库 lint 为 **0 错误 / 100 项既有警告**；静态翻译键缺失 **0**；前后端生产构建通过。条件跳过不计作已验证，打包 MCP 与实际桌面结果另行记录。

日志：`.cache/tunnel-cancel-application.log`、`tunnel-cancel-final-types.log`、`tunnel-cancel-final-lint.log`、`tunnel-cancel-build.log`。首次代理和 HTTP 夹具失败日志分别保留在 `tunnel-proxy-first-tests.log`、`tunnel-cancel-routes-tests.log` 和 `tunnel-cancel-verified.log`；后者是状态断言修正前的失败记录，不是最终通过证据。

上一提交 `6a95ba3` 的 CI **34383269891** 已确认全部成功，包含真实终端、原生模块、安装、在线升级和卸载。本轮代码的 CI 需提交后单独核对。

## 最终桌面与打包证据

Windows 目录包构建通过，包内原生探针验证 13 项依赖；打包 MCP 2 文件 / 3 项通过，包含自动/协作文件传输与本机 Codex 协议发现（不创建模型任务、不调用外部模型、不改日常配置）。本地构建使用已校验 Electron ZIP 和已有原生模块，正式 CI 的原生重编译要求未改变。

实际 Windows 桌面在独立配置、回环 SSH/TCP 中完成：显示中文指纹确认 → 经实际 `/ssh/tunnel/cancel` API 取消 → 弹窗移除且服务端 socket 关闭 → 零认证、零转发、监听端口可绑定 → 再次明确连接 → 中文信任确认 → 实际二进制回显一致 → 停止释放端口 → 正常退出。桌面阶段使用实际取消 API，未把它描述为鼠标点击隧道卡片取消按钮的验证。

结果目录：`.cache/desktop-observation-report-7da6f802-2481-4aec-9e0e-53af81aee8d5`，`tunnel-result.json` 的 cancelledBeforeAuthentication、pendingTrustRemoved、cancelledSocketClosed、explicitReconnectAfterCancellation、forwardingVerified、listenerReleased 均为 true；`tunnel-trust-pending.png` 已实际查看，中文正确。最终认证计数 2 包含 SSH 认证协商，转发连接为 1。

日志：`tunnel-cancel-package.log`、`tunnel-cancel-native-probe.log`、`tunnel-cancel-packaged-mcp.log`、`tunnel-cancel-desktop.log`。均位于 `.cache`，不随源码提交。

最后复查发现：已取消的端点查询若由不支持立即取消的提供方执行，仍可能占据请求队列，使明确的新连接等待旧查询结束。请求观察层现可立即完成取消；底层准备保留原信号检查，HTTP 查询也传递信号。新增实际 HTTP 场景证明：旧查询保持未完成时，新请求已进入真实 SSH 指纹确认；旧查询返回后没有覆盖新配置；随后取消新连接也关闭 socket 且零认证。

该修正后的隧道/代理/指纹组合 **3 文件 / 35 项通过**，日志 `tunnel-cancel-final-targeted.log`；后端类型和编译、受影响请求文件 lint 再次检查。前述完整应用组结果在这次小范围请求观察修正之前获得，不把它描述为最终源码重新跑过完整组。真实 PTY 独立 **10 项通过**，日志 `tunnel-cancel-pty.log`；既有 ConPTY 跨平台兼容风险仍按第 32 份文档保留。

最终包含请求观察层修正的 Windows 包再次通过完整取消/重连/实际转发/正常退出场景，证据目录 `.cache/desktop-observation-report-5e61ba67-bcdd-4775-9018-8547601f8f34`，日志 `tunnel-cancel-desktop-final.log`。最终包原生依赖 13 项与 MCP/本机 Codex 3 项也再次通过，日志 `tunnel-cancel-native-probe.log` 和 `tunnel-cancel-final-mcp.log`。

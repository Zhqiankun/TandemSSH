# 隧道模式协议矩阵

状态：协议矩阵与本轮失败状态修复通过专项、全量回归和 Windows 端口冲突验收。

本轮补 B13/F12/A35 的实际数据通道证据。对单主机 direct S2S 和双主机 managed S2S 分别验证 local、remote、dynamic；SSH 来源和端点为独立回环 SSH 服务，转发只能到本轮拥有的监听端口。静态模式核对原样二进制回显，动态模式进行真实 SOCKS5 握手后再核对数据。停止走既有管理器清理入口，并验证活动连接断开及监听端口重新绑定。保留既有主机信任人工决定，不跳过主机密钥核验。

测试夹具负责模拟 ssh2 服务端远程监听协议和资源清理；产品 manager 负责真实 SSH 连接、流转发和生命周期。无测试代码进入产品运行路径。协议矩阵不替代 Windows 页面操作、真实 Linux/OpenSSH 兼容、权限撤销和所有重连组合；发现实际产品失败时记录复现和修复，不降低断言。

## 已核实的路径与发现

新增单主机/双主机 S2S 六组实际二进制传输和停止释放，及六组端口占用保护；另通过真实 WebSocket 调用 C2S 后端中继，验证 local/dynamic 的二进制通道与 remote 的 streamId 数据回路，关闭中继后 SSH/远程监听释放。C2S 动态模式的桌面 SOCKS5 监听不由后端中继代替，Electron main.cjs 的本机监听仍需完整实机矩阵。

首轮测试把 direct helper 误标为 C2S，负向走通用管理器才揭示 C2S 被明确要求走桌面入口。测试现已改为准确的 S2S 单主机/双主机分类，C2S 单独使用真实中继入口；原分类失败日志保留为 .cache/tunnel-matrix-classification-tests.log。

真实绑定失败暴露最终状态 errorType 丢失，现保留历史分类，识别 EADDRINUSE/address already in use/Unable to bind；中文界面分别说明本地占用与远端拒绝绑定（不把远端拒绝一律解释为占用）。同时将 maxRetries 的缺省判断改为 ??，尊重明确的 0；新增实际断开已连接 SSH 的场景证明无重试计时器或残余活动转发。40 项专项通过，日志 .cache/tunnel-matrix-relay-tests.log。

## 最终验证

最终 40 项隧道专项通过，包括单主机/双主机 S2S 的六组真实二进制转发、六组端口冲突，C2S 后端中继三组数据传输，以及连接建立后断开时尊重 maxRetries=0。双主机模式额外断言监听由正确的 SSH 侧建立，该增强断言复测通过。全量回归 503 个文件通过、1 个跳过，3594 项通过、12 项跳过，273.56 秒；独立 ConPTY 门禁不含在本机该命令内，仍由 CI 单独执行。类型检查、构建、lint（0 错误/既有 100 警告）和中文词条（缺失 0）通过。

实际 Windows 包先验证单主机本地转发：核对服务器指纹前零认证/转发，人工信任后真实二进制回显一致，停止后端口可复用。随后由夹具占用同一监听端口，再连接隧道时返回 failed 和 CONNECTION_FAILED，中文卡片明确显示监听地址/端口占用；屏幕范围及 elementFromPoint 确认提示实际可见。原监听服务仍能原样回显 owner，未被停止或修改。证据 .cache/desktop-observation-report-b5e770a2-834e-4253-b0ff-cff01d4d12dc/tunnel-result.json、tunnel-conflict-result.json、tunnel-port-conflict.png。

首次桌面 e193c1dd-2737-474e-bc56-7f635e771319 已验证后台冲突分类，但脚本使用的刷新事件未让主机进入页面列表，故未打开隧道页。改为实际主机刷新事件、等待主机出现后打开并检查可见性，复测通过；未因此更改产品逻辑。

最终包四份项目/底座声明、13 项原生依赖和 3 项打包 MCP 检查通过，隔离 Codex 可发现 38 个工具。测试应用及 SSH/TCP 服务退出，监听端口释放。两轮用户目录各检查 7 个配置/日志/数据库文件，未发现测试密码明文，未解密数据库；记录 .cache/tunnel-matrix-privacy-check.json。

日志：.cache/tunnel-matrix-final-tests.log、tunnel-matrix-regression.log、tunnel-matrix-types.log、tunnel-matrix-lint.log、tunnel-matrix-localization.log、tunnel-matrix-desktop-final.log、tunnel-matrix-native-probe.log、tunnel-matrix-package-mcp.log。

仍需完成：C2S Electron 本机监听/SOCKS5 与页面启停的完整实机矩阵，真实 Linux/OpenSSH 下的全部适用组合、地址范围、权限撤销和重连。此次协议服务端是实际 SSH2 栈的隔离夹具，不宣称已替代上述环境，也不声称整个 B13/A35 已完成。

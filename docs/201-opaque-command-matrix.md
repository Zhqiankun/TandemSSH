# Shell、解释器与交互程序的未知结果矩阵

2026-09-12，在 alpha.11 云端发布运行期间补充 A12 证据。只改测试，生产源码与已推送标签保持一致。

## 网关验证

扩展已有 OperationGateway 用例为 30 个已识别程序 × 自动/协作两模式；每项再分别使用程序名和 /usr/bin/ 路径。包含 sh/bash/zsh/fish/dash/eval、python/python3/node/perl/ruby、powershell/pwsh/cmd、sudo/su/env/xargs 以及 12 个 TUI 程序。

即使同时存在程序允许规则和任务预授权：非严格模式的决定仍为 unknown，直接 dispatch 返回 APPROVAL_REQUIRED，终端写入为空；严格模式为 deny，approveOnce 和 dispatch 均返回 POLICY_DENIED，终端仍无写入。gateway.test.ts 全文件 90 项通过。

## 中文界面

PolicySettings 使用真实规则校验与 evaluateCommandPolicy，API 适配为测试代理。分别对 /bin/bash、/usr/bin/python3、/usr/bin/vim 试算，显示“需要人工审阅”，不会显示“规则允许”；开启严格白名单后显示“规则拒绝”及中文不透明命令原因。试算不调用保存或接管。界面全文件 10 项通过。

最初新增用例对完整原因文本做精确匹配，而界面把规则备注与生成原因连在一起显示，导致断言失败；改为匹配其中明确的中文拒绝原因后通过，未修改生产显示来迎合测试。两文件合计 100 项通过，ESLint、TypeScript 通过。

## 原始标准边界

A12 保持未完全验证：此矩阵证明上述已识别程序的处理，不证明可以判断任意可执行文件的行为；版本化名称、别名和其他解释器识别覆盖仍需核对。允许规则不构成远端操作系统沙箱。未执行本矩阵中被拒绝的命令，也没有把“无写入”的夹具证据冒充真实远端程序执行测试。

alpha.11 的 Release 34679768304 仍在运行，标签不包含本次新增测试；不得把本轮测试数量计入该标签云端门禁。

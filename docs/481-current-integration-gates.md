# 当前源码联合回归与真实终端/MCP门禁

2026-09-14。对近期配置迁移、日志维护、策略分类和分发声明改动进行整批回归；不新增功能验收编号。

## 强制类型与完整源码回归

tsc -b --force通过，日志.cache/integration-current-types.log。

按CI拆分方式先运行普通套件，显式排除pty-integration以避免资源竞争：
637测试文件：621通过、1失败、15跳过；
5049测试：5016通过、1失败、32跳过；
用时416.20秒。
原始报告.cache/integration-current-results.json及日志.cache/integration-current-tests.log保留，不改写为全绿。

唯一失败是history-command-preview.test.tsx模拟了旧taskHistoryApi，没有新增的storage方法，AuditStorage挂载时报TypeError。只补测试中的稳定存储响应，命令参数、截短提示和旧program回退断言不变，没有修改产品代码来迎合测试。失败项与相关TaskHistory/AuditStorage三文件7项复测通过，日志.cache/integration-history-fix.log。没有为这一测试夹具改动重复整套七分钟回归。

## 真实共享PTY与Shell补跑

显式设置本地PortableGit Bash，TANDEM_PTY_LONG_ROOT=1、TANDEM_PTY_TRACE=1，单worker无竞争运行：
pty-integration、pty-command、copy-plan、process-command-shell、initial-directory。

5文件55项全部通过，无跳过，113.88秒，日志.cache/integration-real-shell-tests.log。覆盖自动顺序执行共享环境与cwd、人工修改后交还、自动/协作、流程/MCP及转换命令接管边界，并补齐主套件未设置Bash路径时跳过的相关Shell用例。没有降低超时或重复启动活进程。

## 实际打包MCP

使用app/release/win-unpacked/TandemSSH.exe及包内stdio入口启动真实进程。stdio与transfer-stdio两文件3项通过，无跳过，日志.cache/integration-packaged-mcp.log。覆盖系统配对、有签名本地通道，以及自动/协作文件操作与取消边界。不是仅以内存transport测试代替已打包程序。

这不等于本轮重新操作了Codex主界面或调用在线模型；协议及打包进程证据按实际范围报告。

## 限制与状态

主套件32跳过包含独立Linux环境相关场景；本轮没有启动Linux实验VM，不将其计为通过。Bash相关补跑与主套件中的已通过用例有重叠，55和7不与5016简单相加。既有Linux直接验收仍由各条目原记录支持。

剩余R01/R09/R10/R11/F11/B14/A12范围不变。秘密参数通道选择未得到具体答复，SECRET_TRANSPORT_UNSUPPORTED未放开；实际程序身份与完整发布声明继续处理。整体72/79，没有推送、触发Actions或公开发布。

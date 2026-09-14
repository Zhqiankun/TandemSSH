# 补齐 Shell 与间接执行入口的严格模式分类

2026-09-14。继续A12，未将未知真实可执行文件身份问题缩小为有限名称列表。

## 复现与修复

在既有自动/协作网关矩阵新增17个程序/文件形式，每个模式同时检查名称及/usr/bin限定路径。旧代码34项失败：ksh/ksh93、csh、tcsh、mksh、tclsh/tclsh8.6、wish、expect，source、点命令、command、builtin、exec，以及.ksh/.csh/.tcl脚本会在程序允许规则和任务预授权下被当作普通allow。

command-policy.ts补齐这些解释执行程序和内建间接入口；扩展对应版本后缀及脚本扩展名识别。程序/参数允许规则仍精确匹配，未把路径或近似名自动当成已授权程序。

## 验证

- 修复前日志.cache/additional-shells-before.log：34失败、160通过，直接复现allow与期望unknown不符。
- 修复后gateway全文件194项通过，日志.cache/additional-shells-after.log。
- 联合gateway/task-runtime/中文PolicySettings共3文件266项通过，无跳过，日志.cache/additional-shells-regression.log。该数量包含前述194项，不重复相加。
- 非严格模式unknown、直接派发APPROVAL_REQUIRED；严格模式deny，approveOnce及dispatch均POLICY_DENIED；终端无写入。中文试算对ksh93/tclsh8.6/source/command显示人工审阅及严格拒绝，不保存规则或接管。
- 原允许规则反例继续通过，不用子串误伤普通程序。

无新增模块、共享抽象或依赖变化。生产策略模块拥有名称分类，网关继续拥有真正派发前授权复核。人工自由终端保持原行为。

## 尚未完成

这只是已复现的分类缺口修复，不读取远端二进制、不证明符号链接或重命名解释器的实际身份，不能称为OS沙箱。A12保持未完整验收，后续继续核对实际程序身份边界。

115/396的secret-ref通道选择仍未得到具体答复。本轮再次以异步问题请求用户选择独立无PTY标准输入或共享Shell临时环境；未根据通用“全部批准”猜测执行语义。SECRET_TRANSPORT_UNSUPPORTED未放开，F11/B14/R09保持未完成。等待此选择时仍继续其他可独立推进的工作。

整体72/79，未推送Git、触发Actions或发布。本地目录包尚未包含本轮分类修复。

最终ESLint和生产构建（含类型检查）通过，日志.cache/additional-shells-build.log。仅有既有资源块体积提示。

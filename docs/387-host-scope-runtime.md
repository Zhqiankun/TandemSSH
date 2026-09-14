# 主机分组变更的运行中任务边界

2026-09-14，继续A22运行资源审查。本轮只修改TaskRuntime测试夹具及用例。

## 已确认边界

生产TaskRuntime的操作网关在派发时比较当前groups与授权时authorizedGroups；production.groups从用户范围主机仓储读取文件夹和标签，并核对username@ip:port与会话身份。该检查不限于导入入口。

测试夹具新增可变groups函数，默认行为保持不变。自动/协作分别运行两步pwd/df，首步实际进入测试传输后挂起完成通知，将原production/tag:restricted分组撤除，再返回首步exit0。两模式均出现HOST_SCOPE_CHANGED，首步succeeded/exit0事实保留，后续df零写入，控制权human，人工输入成功。

这是实际TaskRuntime/SessionControl组合测试，传输受控；不冒充真实SSH覆盖导入。原始日志.cache/host-scope-runtime.log。

## 尚未证明的范围

readOwnedPolicyScope的identity当前只包含用户名、地址和端口，并未包含凭据、代理或跳板配置。仅凭该检查不能认定覆盖导入改变认证/连接参数后，所有运行中资源均撤销。hostFileFence用于人工文件操作排他，也不等于配置变更通知。

下一步需要分别核对已建立终端的固定远端身份、后续重连使用的新配置、AI/MCP授权和隧道/采样消费者；不能简单把所有字段变动都称为换服务器，也不能拿分组测试替代凭据变更验收。

本轮没有新增生产模块、共享抽象或依赖方向。A22保持未完全验收，整体60/79。未推送Git或触发Actions。

TaskRuntime全53项通过；最终tsc -b和修改文件ESLint通过，命令链exit0。日志host-scope-types.log、host-scope-lint.log。

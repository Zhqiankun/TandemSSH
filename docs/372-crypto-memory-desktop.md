# 加密不可用与内存 Key 组合桌面验收

2026-09-14。A16 原始范围：系统加密不可用时不写明文 Key，可选择当前会话内存使用。本轮只补验收脚本及文档，没有修改生产代码。

## 同一客户端组合场景

使用当前本地 Windows 目录包、独立资料目录和本机模拟模型端点。核对后台 PID、父进程、启动文件、运行目录及 DATA_DIR 后，仅在该后台运行期间将 DataCrypto.getUserDataKey 替换为返回 null，模拟产品加密边界无法取得用户密钥。没有破坏操作系统凭据库，也不声称模拟了所有 DPAPI 或设备故障。

在真实中文配置表单输入测试 Key 和自定义接口。默认加密保存被拒绝，显示“加密保护不可用或失败，API Key 未保存。请恢复加密访问后重试。”；提供方列表仍为空，输入保留，内存选项未被自动选中。

随后用户操作明确勾选“Key 仅在本次运行使用”，保存成功。在同一个密钥不可用状态下，保存后的提供方实际携带测试 Bearer 调用本机模型发现端点并获得 memory-model。只查询数据库测试行的 IS NULL 布尔值，api_key 与 api_key_prefix 均为空，没有读取或输出真实密钥。结束时恢复原方法、断开调试连接并正常退出客户端，后台业务端口全部释放。

## 证据与回归

- 脚本：.cache/crypto-memory-observer.cjs、.cache/run-crypto-memory.cjs。
- 原始报告：.cache/desktop-observation-report-a86170e7-c54f-4489-a8fb-e816f242cea3/crypto-memory-result.json，11 项断言全部为 true。
- 日志：.cache/crypto-memory-native.log，客户端 cleanExit=true，脚本 exit0；desktop-process.log 记录恢复后调试断开和后台正常关闭。
- 回归：ai-key-persistence、ai-session-keys、AiProviderSettings，3 文件 24 项通过。日志 .cache/crypto-memory-regression.log。
- 236 的真实桌面重启清除、重新输入可用与撤销清理证据继续适用；202 证明首次写入前加密及失败拒绝，不以外层数据库加密替代该要求。

首次脚本因调试目标 URL 匹配超时；第二次因 Runtime.evaluate 不支持动态 import 失败，均未到故障断言阶段，不能算通过。最终使用已核对归属的 Node 调试端点和 createRequire 加载既有模块后完整通过。失败资料目录保留供复查，失败进程仅清理本轮子进程树。

依据原始范围将 A16 标记 verified，整体 59/79，仍有 20 条未完全验收。未提交或推送 Git，未触发 Actions，公开安装包不变。

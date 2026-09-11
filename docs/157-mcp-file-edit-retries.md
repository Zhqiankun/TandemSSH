# MCP 生产文件工具的原生重试验证

2026-09-12，继续A13。扩展production-file-tools.test.ts，以TANDEM_TEST_REQUIRE_STDIO=1强制使用stdio+签名本地管道+OS凭据存储，未使用内存传输替代。实际结果文件.cache/file-native-automatic.json与file-native-collaborative.json确认transport及sshConnections=1。

自动/协作 × 补丁编辑/完整写入四种场景通过。list_directory、stat_file、read_file及修改提案均并发发送同ID同参数，返回同operationId；读取与修改完成后再次提交仍返回原操作。改内容复用requestId返回REQUEST_CONFLICT，任务只有一条file.write操作。协作模式仍须取得变更审阅凭证后批准，不能因重试绕过FILE_REVIEW_REQUIRED。最终另存文件内容与CRLF正确，只有一条认证SSH连接，没有终端命令写入；断开MCP后任务取消，旧内容引用拒绝使用。

文件服务器是本项目回环SFTP夹具，落地字节真实，不冒充业务服务器或Codex模型调用。系统凭据只用于该测试的临时配对，沿用既有finally清理。本轮仅扩展测试，无生产模块/依赖变更。4项通过，ESLint通过；流程等其他requestId入口仍需核对，A13尚不整体完成。
最终 tsc -b 类型检查通过。

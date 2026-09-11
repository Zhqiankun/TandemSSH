# MCP 文件与目录的并发重试验证

2026-09-12，继续A13。扩展已有真实MCP SDK→Core→TaskRuntime→SFTP夹具/本机文件适配测试，未修改生产代码。

单文件自动/协作两模式中，upload_file与download_file的同一请求并发调用均返回同operationId；协作批准前无传输进度，批准后字节内容和sha256状态正确。完成后再调用仍返回原操作，改为另一目标却复用requestId返回REQUEST_CONFLICT；每种方向只有一条操作记录，释放传输资源后原结果仍可读。

目录上传/下载与自动/协作组合中，同一preview_directory_transfer并发调用复用同operationId，同一run_directory_transfer并发调用复用同runId。原有顺序重复、修改choices冲突、逐项确认和最终内容断言保留。

两文件共7项通过，ESLint通过。此为MCP内存传输与回环SFTP/本机文件夹具，不冒充真实Codex或业务SSH重跑。覆盖单文件传输与目录批次请求；文件查看/编辑提案/提交和流程等其他带requestId入口仍需核对，A13不在此整体标记完成。
最终 tsc -b 类型检查通过。

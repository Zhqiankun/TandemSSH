# MCP 配置导出与复制反馈

2026-09-12，继续 F10 配置导出验收。实际导出是 Codex TOML，不是 JSON。生产 clientConfiguration 返回固定 command、stdio 路径、公开 profile/client ID 和 ELECTRON_RUN_AS_NODE 环境标记；配对秘密由 OS 凭据端口保管，不放入该配置。

## 修复

McpSettings 原先忽略 copyToClipboard 的布尔返回，返回 false 时仍显示“已复制”。修复后复制开始即清除旧成功状态，等待期间禁用复制按钮；false 或抛错均显示现有中文“复制到剪贴板失败”，仅成功才显示已复制。其他配对操作保持原错误处理。未增加模块或改变配对授权和配置协议。

## 验证

- 三个新增用例在修复前失败，日志 `.cache/mcp-copy-reproduction.log`；覆盖 false、抛错和成功后再次失败。
- 修复后 MCP 设置与剪贴板回退两文件共 17 项通过；原配对用例另确认撤销后旧配置不再可复制。
- ESLint、TypeScript、diff 检查通过。
- 额外用实际 mcp-api.ts 格式化函数（TypeScript 转译后，仅模拟其未调用的 HTTP 依赖）和 Python 标准 tomllib 独立解析器核对 2 组数据。中文 Windows 路径、引号、反斜杠、换行和点号环境键均往返一致，只有 tandemssh 一个服务器表；额外顶层 pairingSecret 未输出。报告 `.cache/mcp-configuration-roundtrip.json`。

解析测试不运行生成的 command，也不读写日常 Codex 配置。它证明 TOML 数据转义，不是这两组虚构路径上的实际 Codex 启动。格式化函数会输出后端提供的 env，不能声称它能识别 env 中任意秘密；当前生产生成器的 env 只有固定运行标记。

F10 的配置 API 所有权及全部工具权限矩阵仍需继续归并。本轮复制修复尚未进入公开 alpha.12。

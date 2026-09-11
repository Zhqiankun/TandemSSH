# MCP 服务版本与构建版本一致

2026-09-11。实际 Codex 工具发现中，MCP 一直报告硬编码的 0.1.0-alpha.0，与当前应用不同。本轮保持根 app/package.json 为唯一版本来源，不再单独维护 MCP 常量。

## 责任与契约

write-backend-package.cjs 在构建后将 type、backend name 和根版本写入 dist/backend/package.json。build、build:backend、dev:backend、generate:openapi 和会发射后端代码的 type-check 都调用它，干净 CI 因而可在正式打包前运行 stdio 测试。

MCP version.ts 只读相对模块的两个固定元数据位置，不读取 cwd 或客户端传入的版本。源码目录的纯 ESM 标记不视作版本来源；真实包名称、版本格式及文件大小均检查。缺失/无效时拒绝启动，不回退到旧版本。stdio 在连接桌面桥接之前读取，避免版本错误留下桥接连接，并给出中文重新构建/安装提示。MCP 工厂只负责将已取得版本交给协议适配器。

原生包验证现在比较 ASAR 中应用版本与物理后端元数据版本。Windows 安装升级验收的未发布新版本夹具同步覆盖两处元数据；外部文件集单独打进 ASAR 时不会自动出现在实际后端目录，因此通过额外资源映射交付同内容的物理副本。未修改公共版本的源 package.json 来伪造测试版本。

## 验证

源码模式/构建元数据/未来版本/缺失与非法元数据，以及 MCP 工具接口共 6 文件 / 18 项通过。实际打包 MCP 与当前 Codex CLI 另有 2 文件 / 3 项通过，工具数 38，serverInfo.version 为 0.1.0-alpha.3；实际应用和 MCP 版本匹配的原生探针通过。证据 .cache/mcp-version-tests.log、.cache/mcp-version-codex-tests.log、.cache/codex-mcp-integration.json、.cache/mcp-version-native-probe.log。

额外构建未发布的 0.1.0-alpha.4 目录夹具，应用与后端版本均为 alpha.4，原生包验证通过；只验证真实打包映射，不声称本机运行了 NSIS 升级或公开 alpha.4。记录 .cache/mcp-version-fixture-run.json、.cache/mcp-version-fixture-probe.log。首次夹具元数据仅在 ASAR 内，验证明确失败；补物理资源映射后通过，未降低验证条件。

类型、修改文件 ESLint 和根验证脚本语法检查通过。发布工作流中的实际 NSIS 安装升级仍由 Actions 执行。本轮开发包不用于公开上传，公开 alpha.3 尚未包含此修复。

补充：将已有 dist/backend/package.json 移到自有缓存备份后运行 npm run type-check，元数据重新生成；随后 6 文件 / 18 项再次通过。证据 .cache/mcp-version-clean-typecheck.log、.cache/mcp-version-tests-final.log，覆盖 CI 先类型检查再测试的顺序。

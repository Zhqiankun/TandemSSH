# 锁定版本的 README 许可证补充

2026-09-11，继续核对 88 的 14 个待处理项。七个包的完整 MIT 声明在同版本 README 中，但 README 未被打包；本轮从准确版本提取许可证段落，统一换行为 LF，保留条款与版权内容，不用通用模板替换。

补充范围：assert-plus 1.0.0、isarray 1.0.0、pg-types 2.2.0、pgpass 1.0.5、agent-base 6.0.2、https-proxy-agent 5.0.1、cookie-signature 1.0.6。后三者需按实际版本在依赖树中定位，不能使用顶层较新版本；例如 agent-base 6.0.2 与 https-proxy-agent 5.0.1 来自 axios 的嵌套目录。

原文与映射位于 app/packaging/dependency-notices。manifest.json 记录精确包名/版本、提取文本 SHA-256、README 摘要/行号及锁文件中的包来源与 integrity。integrity 为锁文件原值，此轮未重新下载这些 tarball，不将其表述为本轮独立验证过的归档摘要。

发行生成器按实际随包 name/version 精确匹配补充项，验证源文本摘要，把副本放到 resources/notices/dependencies/supplemental，并在清单中标记 supplemental 来源和 provenance。版本不匹配不套用；原始 license 元数据保持原样。包验证器除清单/汇编之外，还逐字节核对补充副本。职责仍为发行基础设施，不修改依赖运行代码。

10 项测试通过（2 文件），含准确版本匹配、未来版本不套用及补充文本被修改后的拒绝；修改文件 ESLint 通过。真实 Windows afterPack 和 Electron 原生探针通过，341 个包、7 个待核对项，七份补充文本全部存在。证据 .cache/pinned-notices-tests.log、.cache/pinned-notices-package.log、.cache/pinned-notices-native-probe.log。

剩余七项：@napi-rs/keyring-win32-x64-msvc 2.0.0、abstract-logging 2.0.1、base32.js 0.0.1、drizzle-orm 0.45.2、lazy-val 1.0.5、precond 0.2.3、standardwebhooks 1.0.0。部分有短许可证链接或代码版权头，但尚未确认完整原文，不凭关联包的许可证代替。前端打包依赖、字体图标和原生捆绑库也不在此七项范围内，仍需分别核对。公开 alpha.3 不包含此次补充。

后续已通过固定上游提交补齐 keyring 平台包与 drizzle 两份原文，待核对项降到五个；具体来源和未采用的冲突声明见 [90](90-pinned-upstream-notices.md)。

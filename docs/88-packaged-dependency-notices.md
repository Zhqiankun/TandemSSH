# 实际随包 npm 依赖声明

2026-09-11。Windows afterPack 钩子扫描实际 app.asar.unpacked/node_modules，包括 scoped 与嵌套依赖，生成 resources/notices/dependencies/inventory.json 和 THIRD-PARTY-NOTICES.txt。清单记录实际路径、名称、版本、原样声明的许可证、package.json/声明文件摘要与字节数，汇编可解码的顶层 LICENSE/LICENCE/NOTICE/COPYING/COPYRIGHT 原文。

职责为发行基础设施：distribution-dependencies.cjs 生成与验证，after-pack 负责 Windows 接线，verify-native-package 在实际 Electron 中重新扫描并核对两个生成文件。没有运行时业务或数据库依赖。生成确定性输出，不包含本机绝对路径和生成时间；对文件数/大小/累计读取设置上限，拒绝越出包目录的链接路径。缺失声明字段、无顶层文本、非 UTF-8 文本明确记录，不从包名或依赖关系补写许可证。CLI 必须显式选择 --write 或 --verify。

## 实际结果

本机 Windows 目录包经真实 afterPack 生成清单，341 个 npm 包；JSON 157710 字节，文本汇编 547158 字节。实际 Electron 原生探针通过（同时校验原有四份项目/底座声明），再次 --verify 得到 packages=341、reviewItems=14。证据 .cache/dependency-notices-package.log、.cache/dependency-notices-native-probe.log。

8 项测试通过（2 文件），覆盖嵌套多版本、原文与确定性、缺失字段、非 UTF-8、修改后拒绝、目录越界以及 NSIS/dir 钩子；修改文件 ESLint 通过。日志 .cache/dependency-notices-tests.log、.cache/dependency-notices-lint.log。此次仅重打包既有编译产物以验证发行钩子，不把它当作日期汉化等新增 UI 的实机验收。

## 待继续核对

14 个待核对包：@napi-rs/keyring-win32-x64-msvc 2.0.0、abstract-logging 2.0.1、agent-base 6.0.2、assert-plus 1.0.0、base32.js 0.0.1、cookie-signature 1.0.6、drizzle-orm 0.45.2、https-proxy-agent 5.0.1、isarray 1.0.0、lazy-val 1.0.5、pg-types 2.2.0、pgpass 1.0.5、precond 0.2.3、standardwebhooks 1.0.0。均未发现顶层声明文件，其中 precond 还没有 license 元数据；这不证明没有许可证，代码头部及同版本上游原文仍需核对。

该清单只覆盖实际随包 npm 目录。编译进前端 JS 的开发依赖、字体、图标、Electron/Chromium 以及原生组件捆绑的第三方代码必须另行核对，不能将此文当作完整许可审查或完整软件物料清单。公开 alpha.3 尚不包含该生成清单。

后续已从准确版本 README 补齐七份原文，实际包待核对项降至 7；来源摘要、版本锁定和实际打包证据见 [89](89-pinned-readme-notices.md)。原 14 项为首次扫描结果，不代表当前全部仍缺失。

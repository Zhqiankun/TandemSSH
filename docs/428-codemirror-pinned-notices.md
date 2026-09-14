# 固定 CodeMirror 发布提交的三包声明补充

2026-09-14，承接426/427。前端缺顶层原文的4项中，三项已补齐可追溯原文，剩react-remove-scroll-bar 2.3.8一项。

## 来源证据

npm官方指定版本元数据为以下三包提供相同gitHead：990500ad9ae72400272c873df3ae061860ff00c2。

- @uiw/react-codemirror 4.25.11，对应core/package.json。
- @uiw/codemirror-extensions-basic-setup 4.25.11，对应extensions/basic-setup/package.json。
- @uiw/codemirror-extensions-langs 4.25.11，对应extensions/langs/package.json。

读取该固定提交源码归档，核对三个子包的名称、版本、MIT字段一致，目录树没有另一个子包LICENSE/NOTICE。根[LICENSE原文](https://github.com/uiwjs/react-codemirror/blob/990500ad9ae72400272c873df3ae061860ff00c2/LICENSE)为MIT，1060字节，SHA-256 fd1f049b3bb5cbaf5143516b72dbc6805cd30cca0cda94edb37160e37662fd17。保存到app/packaging/dependency-notices/_uiw_react-codemirror-4.25.11.txt。

manifest为三包分别记录准确版本、发布提交、npm元数据URL、源package.json路径与摘要、原文URL及摘要。npm dist.integrity只是官方元数据原值，不声称本轮验证了整个npm压缩包。证据.cache/frontend-notice-provenance.json、codemirror-notice-source.tar.gz、codemirror-notice-source-index.json。

## 接线与验证

前端构建器读取现有固定版本补充清单，只按name/version精确匹配，先验证原文SHA-256再汇编。来源写入每包notices.provenance。缺其他版本不套用当前原文，内容改变拒绝构建；没有把范围扩大为全部上游许可审批。

25项相关测试通过；类型及ESLint exit0。实际build成功，落盘检查packages238/chunks190/reviewItems1，三条补充来源均已读取核对。日志.cache/frontend-supplement-tests.log、frontend-supplement-types.log、frontend-supplement-lint.log、frontend-supplement-build.log。

## 未解决来源

react-remove-scroll-bar 2.3.8的npm gitHead b3b1287aad81def2e2ae707274b74531b61ddbaf在所声明上游仓库codeload请求返回404，git ls-remote精确查询v2.3.8和2.3.8标签没有结果。因此没有拿主分支LICENSE代替固定版本证据。GitHub目录树API请求403后改读源码归档；读取第二个缺失归档的脚本失败仅影响该包，不把前三包证据或第二包来源混淆。

原随包npm5项、字体、独立资源与原生库等仍需继续。总体验收67/79，不关闭R01/R11。未推送Git、未触发Actions。

## 最终目录包

Windows目录打包exit0，实际ASAR检查packages238/chunks190/reviewItems1；包内Electron执行发布运行时探针exit0，13项原生依赖以及文件/目录/恢复/SQLite/系统凭据/PTY等通过。证据.cache/frontend-supplement-package.log、frontend-supplement-package-result.json、frontend-supplement-native.log。公开安装包未更新；目录包验证不代表NSIS安装/在线更新已重跑。

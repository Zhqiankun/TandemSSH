# 终端搜索汉化、选项缓存与桌面验收

2026-09-13，承接 303，继续 F03/B03。

## 实际问题与修复

简体中文原有搜索控件把 Match Case 翻成“火柴盒”、Next Match 翻成“下一场比赛”。本轮修正 zh_CN/zh_TW 的搜索、大小写、整词、正则、前后匹配、关闭和计数文案，计数使用 index / count。

首次真实 Windows 桌面报告 `1072494c-311b-411b-aafe-8aa22d9dce1b` 在切换大小写处失败：目标应由 5 项降到 4 项，界面仍显示 2 / 5。检查已安装 @xterm/addon-search 源码，findNext 在 shouldUpdateHighlighting 之前覆盖 lastSearchOptions，导致同一查询的选项变化不能刷新计数和高亮。本项目通过公开 clearDecorations 接口在切换大小写、整词和正则时清除缓存，再执行搜索；没有改写 node_modules 或调用插件私有接口。

插件会直接构造 RegExp。Terminal.runSearch 在正则模式先用相同 flags 校验；无效表达式清除旧高亮与结果计数并返回，允许用户继续编辑恢复。没有改变普通查询和前后查找语义。

责任边界：Terminal.tsx 编排现有搜索插件及视图状态；本地翻译文件负责文案。本轮无新增模块、共享抽象、后端契约或 SSH 写入路径。

## 验证证据

修复后重建本地目录包，完整桌面重测报告 `.cache/desktop-observation-report-b8597bc1-5678-4257-86c5-8b9285128d38`，search-native-result.json 全部通过：

- 独立 ssh2 服务通过真实 SSH shell 输出固定文本，桌面 Ctrl+F 入口打开搜索。
- 5 项普通匹配、下一项、上一项和 5 次循环返回原索引。
- 区分大小写后 4 项，叠加整词后 3 项；取消选项恢复。
- 中文搜索 2 项、正则 SEARCH_[12] 2 项。
- 不完整正则 `[` 显示无匹配结果；返回普通查询仍可操作。
- 无结果、清空查询、关闭搜索正常；整个搜索矩阵 SSH 接收输入字节为零。
- 原生程序正常退出，测试端口释放；测试日志不含固定认证秘密。已查看 terminal-search.png，输出与计数呈现正确。

脚本 `.cache/run-search-native.cjs`、`.cache/search-native-observer.cjs`；日志 `.cache/search-native-desktop.log`。4 文件 25 项相关回归通过，ESLint 退出 0，完整 build（含类型检查）和目录打包退出 0；翻译缺失键 0。日志 search-final-tests.log、search-final-lint.log、search-native-build.log、search-native-package.log、search-locales.log。

本验证使用受控 SSH 输出，不声称执行了 Linux 命令。Windows 实际输入法候选窗口仍未人工验收；303 的 IME 证据为 DOM 回归测试。F03/B03 还有标签/分屏、系统剪贴板、完整快捷键、编码和字体主题等待验收，整体保持 44/79。未提交、推送、打标签或触发 Actions。

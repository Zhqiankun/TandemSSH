# 字体预加载与渲染解析一致

2026-09-14，完成444发现的字体预加载入口仍未转义问题。

terminal-global-styles.ts的ensureTerminalFontsLoaded现在复用resolveTerminalFontFamily，四种变体使用与实际渲染相同的有效CSS字体列表，避免直接拼接自定义引号或反斜杠导致FontFaceSet语法拒绝。原普通/粗体/斜体/粗斜体请求数量与无fonts API/加载失败容错保留。依赖方向为终端预加载模块→既有字体解析模块，无循环、新共享抽象或数据库/API变更。

13项相关测试通过；类型、ESLint、完整build及Windows目录包exit0。日志.cache/font-preload-tests.log、font-preload-types.log、font-preload-lint.log、font-preload-build.log、font-preload-package.log。

## 真实浏览器结果

报告.cache/desktop-observation-report-50071e4a-def6-433e-b797-2bc80d3bf3ce及同名-restart目录。记录真实document.fonts.load的原Promise结果，不替换解析或返回值；每次启动12个匹配测试字体名的加载请求全部resolved，包含四种变体且无拒绝。两个font-load-result.json已按变体逐一核对。

同一轮同时验证xterm实际字体度量宽10.4462890625、高22，与19px回退链相等；Dracula背景、保存字体原值及真实SSH收发保持。自定义测试字体并未安装，Promise resolved在这里证明字体列表可解析/加载流程完成，不被解释为该缺失字体实际存在。

两个客户端cleanExit=true、runner exit0、业务端口已释放；两份进程日志均单独检查，无固定测试认证秘密。日志.cache/font-preload-desktop.log。

此项完成特殊名称预加载与回退的当前包双启动证据，不代表所有系统字体、全部主题组合或完整终端快捷键已验收。整体67/79。未推送Git、未触发Actions，公开安装包未更新。

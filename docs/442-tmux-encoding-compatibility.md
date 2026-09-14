# 托管 tmux 的编码兼容校验

2026-09-14，继续F03/B03。应用内tmux/helper固定使用tmux -u，而旧编码终端按GB18030/Big5/Shift_JIS转码；该组合不能作为正确显示连接使用。

## 明确行为

自动tmux或显式tmuxAttachSession连接请求在SSH建连前校验有效终端编码。非UTF-8返回TMUX_UTF8_REQUIRED，清理认证等待状态；前端显示中文原因并停止无效自动重试。主机保存的编码不被自动改写。

已连接会话的应用内tmux_attach也根据session.inputEncoding拒绝不兼容附着，只弹提示，不关闭正常终端。Tmux监控打开TerminalApp时在创建终端前给出相同提示。HostEditor中旧编码与autoTmux并用时直接显示说明。简繁中文和其他语言回退词条已补齐，缺失字面量词条0。

用户可明确选择UTF-8，或关闭自动tmux使用普通旧编码终端。普通手工输入没有新增命令拦截，符合人工自由接管约定；此处不宣称可替用户保证手工运行任意程序后的编码匹配。

## 验证

17项相关测试通过，1项真实/bin/sh解析测试按Windows平台跳过。覆盖三个旧编码监控附着入口的中文提示、旧编码普通终端不被阻断、UTF-8显式附着保留，以及原编码/tmux命令测试。类型、ESLint、完整build与Windows目录包成功。

实际Windows报告.cache/desktop-observation-report-c80cfcb7-551f-461c-9fd3-d83e62ccc5e1/tmux-encoding-result.json已读取：GB18030/Big5/Shift_JIS三个自动tmux请求出现中文提示，受控SSH服务认证次数均0。客户端cleanExit=true、runner exit0、30001–30012无监听。此轮证明错误组合认证前被拒绝，不冒充三种旧编码可以在tmux里正常运行，也不冒充新做了UTF-8/Linux tmux全过程验收。

日志.cache/tmux-encoding-tests.log、tmux-encoding-types.log、tmux-encoding-lint.log、tmux-setting-lint.log、tmux-encoding-build.log、tmux-encoding-package.log、tmux-encoding-desktop.log。

后端边界仍由现有终端适配器处理，UI只展示/预检，无新数据库或共享utils。整体67/79，终端其他验收继续。未推送Git、未触发Actions，公开安装包未更新。

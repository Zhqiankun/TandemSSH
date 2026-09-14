# S2S准备失败取消计时器与释放名额

2026-09-14，核查420失败释放时发现：DNS准备失败直接返回，但此前60秒连接超时计时器仍存在，之后可能再次触发断线/重试逻辑。代理准备失败有相同返回路径。

manager新增本次连接的abortPreparation闭包：只删除仍指向本次controller的索引，触发既有AbortSignal清理，取消连接计时器并销毁本次SSH对象。DNS/代理失败分支调用该清理，再保留原失败状态与原因；不会由旧close事件重新处理重试。启动准入仍由420的finally释放。

回归先复现DNS失败后计时器从0变为1。修复后测试增强为连续40个不同名称的DNS失败，超过全局32名上限但每次正确释放，因此全部到达预期DNS错误；计时器保持原数量。推进假时钟61秒后DNS总调用仍40、无重试timer/连接中标记、原失败原因不变。

真实隧道/准入完整回归2文件71项通过，最终日志.cache/s2s-prepare-failure-release-final.log。生产修改的tsc -b和ESLint通过，日志s2s-prepare-failure-types.log、s2s-prepare-failure-lint.log；其后仅将失败测试重复数扩至40并重跑完整回归。初始复现日志s2s-prepare-failure-before.log保留。

计时器测试用受控DNS失败和假时钟，不称为等候真实61秒的网络实测。模块职责仍在manager连接准备/生命周期，没有新共享模块。当前修复尚未打包，整体65/79，未推送Git或触发Actions。

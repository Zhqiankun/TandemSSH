# 跳过已有连接与模式切换的桌面验证

2026-09-14，将385修复构建到本地Windows目录包。无新增生产代码。

独立资料目录创建两条相同连接目标的原记录。每种JSON/SSH格式先通过实际覆盖菜单导入单条匹配记录，确认收到重复目标拒绝且原快照不变；再换成包含一条已有目标及两条重复新目标的文件，通过真实非覆盖菜单先取消、再确认。

共六次原生确认框均由测试文件名与阶段限定。覆盖框显示“是”，切换非覆盖后显示“否”，证明overwrite选择未残留。读取各次真实Network响应：非覆盖success=1、updated=0、skipped=2、failed=0，中文完整计数可见。所有先前主机完整API快照不变，新目标只有一条且名称来自首项。取消时也无写入。

报告.cache/desktop-observation-report-bafc740a-281e-4107-a2ef-c6d83941d1e1/skip-import-result.json已读取，两种格式全部通过。脚本skip-import-observer.cjs、run-skip-import.cjs；日志skip-import-native.log。客户端cleanExit=true、脚本exit0，业务端口释放，没有连接真实外部主机。

build及目录打包通过，日志skip-desktop-build.log、skip-desktop-package.log。当前本地包包含385跳过修复及384菜单，公开安装包未更新。未推送Git或触发Actions。

A22仍保留完整覆盖差异、预览绑定与运行中资源影响的剩余验收，整体60/79。本轮不把单请求重复处理泛化为并发导入唯一性保证。

# SSH覆盖导入入口与重复目标桌面拒绝

2026-09-14，补齐383的桌面验证，同时修复SSH配置覆盖功能只有后端能力、没有可选菜单入口的问题。

HostsPanel.tsx的两处导入菜单均新增“导入 SSH 配置（覆盖）”。点击后沿用已有importOverwriteRef快照和SSH文件处理链；保留原非覆盖入口。新增中文简繁与英文文案，其他语言英文回退，不新建业务服务或共享抽象。

## 真实桌面

独立资料目录预建同地址/端口/用户名的两条主机，不连接远端。通过实际Radix菜单分别选择JSON覆盖与新增SSH覆盖入口，拦截本轮文件选择器后用原生文件输入提交磁盘文件。每种格式先取消再确认，四次原生确认框均显示“覆盖已有连接：是”。

取消后实际主机API完整快照不变。确认后观察该次Network响应并读出failed=1、updated=0及HOST_IMPORT_TARGET_AMBIGUOUS，随后断言中文拒绝原因可见。再次读取原主机完整快照一致。不是仅凭上一条仍在屏幕中的toast判定请求完成。

原始报告.cache/desktop-observation-report-35154f96-0609-4fa2-92a2-bb035de4990d/overwrite-import-result.json已读取，两种格式全通过。脚本overwrite-import-observer.cjs、run-overwrite-import.cjs；日志overwrite-import-native.log。客户端cleanExit=true，脚本exit0，业务端口释放。

## 验证与限制

tsc -b、build、HostsPanel ESLint、本地化检查和electron-builder目录打包通过；日志overwrite-ui-types.log、overwrite-ui-build.log、overwrite-ui-lint.log、overwrite-ui-localization.log、overwrite-ui-package.log。脚本生成时出现正则转义语法错误，在启动客户端前通过node --check发现并修正，未计作产品缺陷。

当前本地包已包含383后端拒绝及本轮SSH覆盖菜单。没有完整字段覆盖差异或预览版本绑定，运行中资源影响仍待验证，A22不标记整体通过。总体60/79，未推送Git或触发Actions。

# 中文命令历史管理界面

2026-09-14，补齐F03实际可见入口。此前Terminal只有始终为false的旧历史状态及Context回调，没有可打开的历史查看界面；不能以已有HTTP接口和补全等同于完整查看功能。

## 交付行为

新增CommandHistoryDialog：显示主机名称及用户@地址:端口，支持搜索、完整只读预览、复制、删除所选、确认清空及“追加到终端”。工具栏新增命令历史按钮，断线界面也有查看入口。沿用应用现有对话框、按钮、字体和主题样式，简繁中文及其他语言回退完整。

追加只发送所选原文本，不按回车；目标固定为打开时的hostId/sessionId，断线或会话变化后禁用，点击时再次核对WebSocket及会话。含控制字符记录可预览/复制，不能直接追加。复制沿用现有平台适配器。删除失败保留界面记录并提示刷新核对；清空必须单独确认。后端操作结果不明时不谎称“未更改”。

删除/清空同步当前主机的补全缓存，清空会使在途旧快照失效，防止已清记录被重新填回；新保存记录仍可加入。旧主机回调不更新新主机菜单。

## 模块责任

CommandHistoryDialog负责这一业务界面的请求编排与加载/失败/选择状态；API沿用command-history-api。控制字符判据位于历史领域completion模块，界面与最终发送入口共用。Terminal负责会话绑定和实际发送，TerminalToolbar仅新增公开回调。useAutocompleteHistory新增有作用域检查的clear能力。无数据库或后端协议变更，不新增全局shared存储。

## 验证

56项相关测试通过，覆盖工具栏入口、搜索预览、显式追加、复制参数、删除失败/重试、清空确认、失效会话、控制字符、迟到旧主机响应和清空后快照防回填，包含工具栏既有回归。类型、ESLint、build与Windows目录包exit0；中文字面量缺失0。

实机报告.cache/desktop-observation-report-ca1b4e61-acbc-4a24-bd76-8c57b9fa0364/history-dialog-result.json已读取，history-dialog.png已查看。通过可见按钮的鼠标命中检查打开历史，中文完整预览正确，追加实际SSH字节与原文相等且不含回车；界面删除后API确认另一条保留；清空确认前记录仍在，确认后API为空且界面显示空状态。客户端cleanExit=true、runner exit0，30001–30012无监听，日志未出现固定认证秘密。

日志.cache/history-dialog-tests.log、history-dialog-types.log、history-dialog-lint.log、history-dialog-build.log、history-dialog-package.log、history-dialog-desktop.log。

开发中修正了一处JSX闭合缺失；控制字符预览首轮测试因可访问名称保留换行而定位失败，改用匹配空白的名称后验证按钮仍禁用。未取消安全断言。若辅助脚本解析失败，其后测试通过不作为该辅助检查成功证据。

## 范围

实际复制剪贴板本轮未再次操作，复制参数有组件测试，系统剪贴板适配器沿用既有独立证据；真实失效会话追加场景仍可继续加强，不将prop禁用测试冒充所有重连实测。旧Context兼容代码保留，未做无关清理。受控SSH仅接收数据，不执行Linux命令。

F03新增可使用的历史管理功能及当前界面证据，整体67/79。未推送Git、未触发Actions，公开安装包未更新。

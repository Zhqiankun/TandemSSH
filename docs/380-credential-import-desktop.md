# 凭据导入中文原因与真实桌面验证

2026-09-14，将377—379修复构建到本地目录包，并修复用户无法看到导入失败原因的问题。

## 前端修复

HostsPanel.tsx 的 JSON/SSH 配置导入原本只显示失败条数，忽略接口 errors。现在警告提示附带前三条错误原因并显示10秒，沿用接口返回的文字和现有toast，不新增业务模块或共享抽象。批量全部错误没有新增独立详情面板；本轮不声称一次提示展示全部错误。

## 同一真实客户端

独立用户资料创建两份名称Deploy/deploy的测试凭据，用真实 DOM.setFileInputFiles 选择磁盘上的三个JSON文件，每个分别取消一次、确认一次，共六次受限定文件名和阶段校验的原生确认框。

- 无效ID：显示中文“引用的凭据不存在或不可用，请重新选择凭据后导入。”，主机列表不变。
- 重复名称：显示中文“凭据名称对应多条记录，请明确选择凭据后导入。”，主机列表不变。
- 有效ID：即使两份凭据名称冲突，明确指定ID仍成功新增且绑定指定凭据；中文新增计数可见。
- 三次取消均不改变主机列表。

报告 .cache/desktop-observation-report-fff6b372-e1b2-49cd-8f3d-7f127d298dd3/credential-import-result.json已读取；missing/ambiguous的中文错误断言与valid正常导入均通过。valid的chineseReasonVisible=false表示该成功场景没有错误原因，不表示中文新增提示失败。截图credential-import-missing/ambiguous/valid.png保存，中文可见性由实际DOM断言验证。

观察脚本import-credentials-observer.cjs、run-import-credentials.cjs；日志import-credentials-native.log。客户端cleanExit=true，脚本exit0，业务端口释放。没有连接外部SSH或真实模型，所有凭据均为隔离测试数据。

## 验证范围

tsc -b、HostsPanel ESLint、build及electron-builder目录打包通过，日志import-ui-types.log、import-ui-lint.log、import-ui-build.log、import-ui-package.log。先前导入后端23项及归属/别名证据见377—379，不重复计作本轮新增测试。

桌面本轮验证新增导入；覆盖不改原记录及跨用户拒绝仍引用377/378真实HTTP+SQLite证据。SSH配置共享错误显示分支经类型检查，本轮没有重新执行其原生导入。

A22仍需高级字段及运行中资源影响验收，整体60/79。当前本地包已含377/379后端及本轮前端修复，公开alpha.14不变。未推送Git、未触发Actions。

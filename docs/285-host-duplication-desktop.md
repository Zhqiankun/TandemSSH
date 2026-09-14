# 主机复制后的真实 SSH 登录验收

2026-09-13，承接 284，F01 / B01 局部验收。重新构建当前 Windows 目录包，连接隔离 Alpine 3.24.1。

密钥和密码两类分别执行完整 UI 路径：通过主机菜单“克隆主机”创建中文“（副本）”，主机列表读取确认新 ID、原认证类型、中文备注和停用的自动采样；列表响应不含 password/key/keyPassword 材料。通过副本行上的实际终端按钮连接，新副本单独出现正确服务器指纹确认。源主机和副本均进入真实 SSH 会话，并执行 printf 标记命令。

最终脚本使用 elementFromPoint 验证输入焦点属于屏幕最上层 xterm，不能只用 getClientRects 判断后台终端可见性；同时等待真实 WebSocket 数据及当前页面可见标记结果。已查看密钥截图，活动标签“密钥主机（副本）”下明确显示 CLONE_COPY_key。

成功报告 `.cache/desktop-observation-report-564c9e9d-4640-4909-acf2-4f8987cb7515/duplicate-native-result.json`，两类认证均为 true；截图 duplicate-key.png / duplicate-password.png。应用正常退出、端口释放。

失败/不足证据保留：首轮辅助函数 connect 与调试连接函数重名，连接前报错，修复脚本命名；随后 ab93e9d5-4897-42f5-b7ae-2f78a3fd69a7 中副本已创建但过早发送 open-tab 事件未打开副本，改为实际主机按钮；3dbb9d56-fd52-4701-991f-453b61c53d1c 虽已证明两类副本建立连接，但截图未显示副本标记命令，发现焦点可能落在后台终端，因此不作为副本命令执行证据。最终增加最上层焦点及可见文本检查后重跑通过。期间一次脚本生成因引号语法错误失败，未修改生产代码。

范围：真实 key/password 复制登录完成；credential 引用保留仍只有 284 的数据库验证，本轮未额外建立凭据引用型原生连接。此结果不代表 F01/B01 的新建/编辑/删除/分组/收藏/搜索/最近连接/导入导出全部验收完毕。计数保持 38/79。

构建日志 .cache/duplicate-native-build.log / duplicate-native-package.log，最终运行日志 .cache/duplicate-native-desktop.log。未提交、推送、打标签或触发 Actions。

清理结果：桌面观察器退出码 0；专用 VM 按准确 manifest 停止，返回 forced=true，启动器退出码 0；不把强制 VM 清理称为正常关机。

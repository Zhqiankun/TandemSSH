# 文件与终端双向目录联动实测

## 发现与修复

2026-09-12，Windows 目录版客户端连接本机隔离 Alpine OpenSSH，发现终端工具栏确认目录查询后提示“无法确认当前终端目录”。前端发送 `{type: "get_cwd", shellReady, requestId}`，而后台 parseWsMessage 仅将 data 字段交给处理器，导致请求编号缺失。原客户端测试复述了错误载荷，底层 PTY 测试也未覆盖该 WebSocket 契约。

已改为 `{type: "get_cwd", data: {shellReady: true, requestId}}`。客户端生命周期模块仍负责消息发送与关联，后台沿用现有解析器及授权检查，没有新增生产模块或跨层依赖。回归测试调用后台实际 parseWsMessage 检查发出的消息，测试层跨边界验证契约，生产依赖不变。

## 实际证据

- 目录查询客户端 7 项和后台控制权 9 项，共 16 项通过；TypeScript、针对性 ESLint 通过。
- 当前源码重新 build 与 electron-builder --win --dir --publish=never 成功；仅本地验收，不上传公共安装包。
- 成功报告：`.cache/desktop-observation-report-181edf23-ec45-44bb-b85e-d911ff5fd918/b11-desktop-result.json`。
- 文件面板右键“在此文件夹中打开终端”，目录名为 `中文 ' quoted`；通过终端执行 pwd 写入独立证明文件，再用真实 SFTP 读取，值与目标目录完全一致。
- 打开独立终端页，人工 cd 到“下一层”；从终端工具栏点击“文件”，观察并接受中文空闲 POSIX Shell 确认，随后文件面板显示该子目录内的“联动证明.txt”。
- `terminal-to-files.png` 已实际查看；客户端正常退出，观察器退出码 0。专用测试根目录已清理。

## 失败记录与范围

首次观察器误用完整文字匹配含快捷键的菜单；随后观察器分别误找内嵌终端工具栏、误点侧栏同名按钮。修正脚本后，报告 7e5892f0-e302-4a38-b3cc-7fe1848d02f3 复现上述真实消息契约错误。修复产品后重跑成功，没有把早期脚本失败算成产品通过。

观察器与启动脚本为 `.cache/b11-desktop-observer.cjs`、`.cache/run-b11-desktop.cjs`；隔离虚拟机 b01a3461-e573-4ca7-95ff-8757b0846731。B11 的复制远端路径、定位本地下载目录仍需桌面归并，因此不标记整体完成。反向查询限定用户确认的空闲 POSIX Shell，不声称任意交互程序或 Windows SSH Shell 都支持。修复尚未进入已发布 alpha.9。

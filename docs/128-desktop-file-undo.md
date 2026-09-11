# 真实桌面目录复制与撤销验收

2026-09-12。基于 2d5f13f 的本地 Windows 目录包开展 UI→HTTP→SSH 集成验收，使用独立应用 profile 和项目隔离 Alpine VM。不是公开发布包。

首次 a4ca6d52、第二次 97b7f93c 观察因脚本交互失败：目录单击会打开目录；快捷键标签被拆成多段并带换行。脚本改为实际右键菜单并规范化菜单空白。第三次 c87290f5 在复制目录后等待目标超时。

源码检查发现复制路由缺陷：cp 不带递归选项；stderr、close、error 监听嵌套在 stdout data 回调内，命令不输出 stdout 时不会处理失败退出，多个 stdout 块还会重复注册完成处理。修复为 cp -R --，将这些监听独立注册。接口既有 uniqueName 命名契约保留，桌面观察相应检查实际生成的名称，不假定复制名称等于源名称。

新增 copy-route.test.ts：silent-failure、silent-success、stream-error、multiple-output 共 4 项通过，确认无 stdout 时也完成响应、多段输出只响应一次；ESLint 通过。文件责任仍由 action-routes 承担协议与既有命令适配，此次不引入新共享抽象。

后续实际桌面复测结果待补充。此文档不作为 B09 完成证明。

## 修复后实机结果

独立报告 .cache/desktop-observation-report-9e644a6e-9d5c-49a3-813b-1144ae59cdcc/undo-desktop-result.json。客户端确认为本地新构建的 Windows Electron 包，中文 zh-CN；目标是隔离 Alpine 3.24.1 / OpenSSH VM 95e614ae-7656-4632-8255-26e800792634。不是模拟 SFTP。

1. 在文件右键菜单复制包含 child.txt 的目录，通过路径栏导航到另一目录并粘贴。独立 SFTP 枚举实际 uniqueName，确认子文件内容一致。
2. 返回源目录后 Ctrl+Z 撤销复制，独立 SFTP 确认副本路径消失且源目录子文件内容保持。
3. 文件右键菜单剪切目录，在目标目录粘贴；独立 SFTP 确认目标子文件存在且源路径消失。
4. 返回源目录后 Ctrl+Z 撤销移动，独立 SFTP 确认源子文件恢复、移动目标消失、内容一致。

undo-copy-other-directory.png 与 undo-move-other-directory.png 已保存；后者已人工查看，中文成功提示显示已将 1 个文件移回原始位置，源目录列表已恢复。应用正常退出并释放后端端口，临时远端目录在 finally 清理。完整 build（含 TypeScript）及本地目录打包成功。

这次实机范围是正常目录复制/移动/异地撤销。部分失败保留、重连中止只有既有单元测试和调用检查证据，未在本次桌面流程中注入，不声称已完成。复制超时结果、既有目标命名竞态及其他文件矩阵仍需独立审查。

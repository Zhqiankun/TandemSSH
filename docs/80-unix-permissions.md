# Unix 权限编辑修复

2026-09-11，针对原始 B10 的 Unix mode 查看/修改。主智能体独立完成；不以此替代链接跟随、所有者/组修改的完整验收。

## 已发现并修复的问题

旧界面仅移除文件类型 `-`，导致 `drwxr-xr-x` 的目录权限错位；数字权限仅保留后三位，不识别 s/S/t/T。后端也截掉第四位，而且允许 8/9 进入 chmod。修复后保留并显示完整特殊位，增加中文 setuid/setgid/sticky 选项，普通权限复选框具备可访问名称。无法识别原权限时禁用保存并显示中文提示，避免把未知值变为 0000。重新打开对话框重新读取原始权限。

接口严格接受字符串形式的三至四位八进制，保持会话所有权检查。执行时补齐五位数，使用 `--` 分隔路径，保留原有单引号转义。GNU chmod 对目录的四位以下模式会保留某些 set-ID 位，明确清除需要五位数字；参见 [GNU Coreutils 文档](https://www.gnu.org/software/coreutils/manual/html_node/Directory-Setuid-and-Setgid.html)。仍由远端账户的实际权限决定修改是否允许，不使用提权。

## 责任与验证

`ui/features/file-manager/permissions.ts` 只负责文件权限编辑器的 Unix 文本解析，组件负责交互和保存编排；它不成为后端依赖。后端 action-routes 负责严格输入验证与既有执行通道，没有数据库或授权契约变化，也没有新增跨业务共享层。

2 文件 / 18 项专项通过：目录及特殊位解析、中文保存/取消 sticky、未知权限禁止保存、后端完整模式传递、非法模式拒绝及会话越权拒绝。日志 `.cache/unix-permissions-tests.log`。修改文件 ESLint 通过。路由测试使用模拟 SSH 通道，不能代替真实 Linux 文件 mode 读回；真实 GNU/BusyBox 与实际 Windows 界面验收仍需继续，当前未发布安装包。

完整 TypeScript 项目检查通过，日志 `.cache/unix-permissions-types.log`。

## 真实 Linux / OpenSSH 验证通过

本轮启动专属 Alpine 3.24.1 虚拟机（UID 1000），测试调用产品 registerFileActionRoutes/execChannel，通过真实 OpenSSH 执行 chmod，并通过独立 SFTP stat 读回。目录依次 1777、2755、0755、0700，文件依次 4755、2750、0644，共 7 次全部一致；其中 2755 → 0755 确認 setgid 已清除。中文、引号和 shell 字符路径保持字面值，测试目录及远端用户主目录均未出现注入标记。888 被接口拒绝且文件仍为 0644，不存在的文件返回 500。

可复用测试：app/src/backend/tests/linux/permissions-acceptance.test.ts。运行时设置 TANDEM_LINUX_MANIFEST 为项目脚本创建的隔离 connection.json，再运行该 Vitest 文件；未配置时显式跳过，不声称普通 CI 已运行 Linux VM。证据 .cache/unix-permissions-linux-results.json，1 个真实集成场景通过（含上述子断言），873 毫秒；类型检查和新增测试 ESLint 通过。虚拟机 4129213a-350d-48dc-b8c5-ba1257e278f7 正常退出，vmExited.code=0，日志 .cache/unix-permissions-linux-lab.log。

该结果证明 Alpine/BusyBox 和 OpenSSH 上的实际权限行为，尚不代替 GNU 工具环境、Windows 实际对话框及所有者/组修改和链接跟随的完整 B10 验收。

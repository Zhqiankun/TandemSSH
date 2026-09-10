# 符号链接路径完整性

2026-09-11，B10 后续修复。原接口再次 decodeURIComponent 已被 HTTP 层解码的 path，导致字面 % 编码或单独百分号被误处理；stat/readlink 输出按换行拆分，使包含换行的目标截断，并把所有非目录目标视为文件。

新增 file-manager/symlink-route.ts 拥有人工文件浏览器的只读链接查询接口。content-routes 只注册它；复用既有 getSessionSftp 与 SftpFileIO，依赖方向为路由 → 文件 I/O，不反向依赖界面，不引入通用共享抽象。接口返回字段不变；保留会话所有权检查，路径按原值传递，不再执行 shell。用 realpath 与 lstat 得到目标和类型，只返回文件或目录；断链、管道、设备及解析后再次变成链接的对象返回失败。路径有长度/NUL 检查，单个 I/O 10 秒、包含通道打开的请求总等待 15 秒上限。

界面主动打开链接文件时将目标类型明确置为 file，错误使用已有中文“解析符号链接失败”提示。该查询只返回元数据，不授权读取或写入目标；后续文件读取、编辑及 AI/MCP 路径授权继续走原有入口。

12 项路由测试通过：百分号/换行/末尾空白保持、目录与文件识别、特殊对象拒绝、非法路径、所有权、断链和停滞通道超时。证据 .cache/symlink-route-tests.log；完整类型检查通过。修改文件 lint 已移除不用的导入，保留原 FileManager 的一个 windowId 警告；翻译静态键无缺失。真实 SFTP 链接矩阵和 Windows 主动跟随界面仍需验证，不标记完整 B10 完成。

本次修改在 alpha.2 标签之后，未混入该标签，后续版本再发行。

## 真实 HTTP / OpenSSH / SFTP 验收

新增 app/src/backend/tests/linux/symlink-acceptance.test.ts，使用真实 Express 回环 HTTP 和隔离 Alpine 3.24.1 OpenSSH。以 SFTP 创建含百分号、换行和末尾空白的文件/目录及相对链接，再经 URLSearchParams 发给产品路由，目标与类型完整匹配。断链、循环链接、指向 FIFO 的链接均为 500，FIFO 仍保持特殊文件类型，没有打开或读取管道。

结果：1 个真实集成场景通过（含两种有效目标、三种拒绝目标），851 毫秒；.cache/symlink-linux-results.json、.cache/symlink-linux-tests.log。首次夹具使用终端 quoteShellWord 创建换行路径，被既有 UNSUPPORTED_TERMINAL_CONTROL_CHARACTER 拒绝；改用 SFTP 创建后通过，未放宽产品终端保护。初次日志 .cache/symlink-linux-initial-failure.log 保留。专属虚拟机 ca9d8dd2-3f2d-47d9-9e0e-fb023a3693bb 正常退出。测试依赖显式 TANDEM_LINUX_MANIFEST，没有该变量时跳过，不把云端普通测试计数当作 Linux 实机证明。

Windows 实际文件列表主动跟随和目标显示仍待验收；不据此标记完整 B10 完成。

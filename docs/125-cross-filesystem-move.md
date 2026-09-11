# 跨文件系统移动后备实现与 Linux 实机验证

2026-09-12。标准 SFTP RENAME 遇到跨文件系统可失败，不能据此缩减原移动能力。本轮 moveItem 提供显式后备：仅收到服务器确定失败码 4、再次确认目标不存在时，使用原已认证 SSH 连接执行 mv -n -T -- source target。重命名入口不启用该后备。

依据 [GNU mv 文档](https://www.gnu.org/s/coreutils/manual/html_node/mv-invocation.html)，-n 禁止覆盖但跳过可返回零，-T 要求目标为精确路径而非移动入现存目录。因此执行后还必须确认源消失且目标存在；两者都在则报冲突，缺失状态、非零退出、超时均为 MOVE_RESULT_UNKNOWN，不自动再尝试其他命令。既有目标在命令前拒绝，命令选项保留至 --，路径完整引用。最多等待 60 秒，异常关闭通道不代表回滚已发生副作用。

move-command.ts 属于人工文件移动适配，复用 session.execChannel，不新建 SSH，不 sudo，不使用可覆盖 mv。Windows 风格远端路径明确报 MOVE_CROSS_DEVICE_UNSUPPORTED；不支持 -n/-T 的远端工具失败，不降级成普通 mv。正常 SFTP 路径继续优先。

3 文件 / 29 项通过：精确引号、既有目标不派发、跳过不假成功、未知/失败不重试、正常源目标后置检查，以及已有 SFTP 重命名和路由。此为通道夹具测试，尚需真实跨文件系统文件/目录验收。它依赖远端 mv 的成功复制/删除语义，不声称额外实现了哈希验证或消除所有外部并发修改竞态。B09 不标记完成，文档 123 的跨文件系统限制已进入实现阶段但尚未验收。
ESLint 和 tsc -b 通过；补充同步 SFTP 失败的定时器清理后，6 项后备移动测试再次通过。

## 真实 OpenSSH 跨文件系统验收

2026-09-12，隔离 Alpine 3.24.1 / OpenSSH 虚拟机 24436c02-95f1-437c-abea-9d744439bbe3。新增 src/backend/tests/linux/move-acceptance.test.ts，先读取磁盘目录与 /mnt/tandem-full 的设备号并确认不同，再调用生产 moveFileItem → moveWithNoClobber → execChannel，全程复用原 SSH 连接。真实 SFTP 失败触发后备次数也作断言。

- 含中文、单引号、命令替换字样、换行的文件名跨盘往返；8192 字节二进制内容逐字节一致，源路径消失。
- 含子文件及断开符号链接的目录跨盘移动；内容和链接类型保持；断开链接本身也能反向跨盘移动。
- 既有文件、既有目录拒绝移动；源和目标内容保持，未移动进既有目录。
- 在最终目标 lstat 后、真实 mv 前，通过同一 SFTP 写入竞争目标；真实 mv 拒绝覆盖，源和竞争目标内容保持，返回 FILE_TARGET_EXISTS。
- 将 2 MiB 文件移入 1 MiB tmpfs，返回 MOVE_RESULT_UNKNOWN；源文件逐字节保持。失败后目标可能有部分内容，测试不声称事务回滚。

结果：1 项集成场景通过（10.48 秒），原始结果 .cache/move-linux-results.json；ESLint 与 tsc -b 通过。测试 finally 只清理本次 UUID 临时目录。此证据覆盖 Linux 实际跨盘后备路径，不等价于 Windows 远端支持，也不替代文件管理全部 UI、撤销及传输矩阵验收，B09 继续保留未完成状态。

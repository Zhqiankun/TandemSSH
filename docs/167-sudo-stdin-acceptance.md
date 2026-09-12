# sudo 密码标准输入与真实 Linux 删除验收

2026-09-12。检查手工文件操作 sudo 时发现，session.ts 将密码拼入 echo 管道，密码因此成为远端 Shell 命令的一部分。改为 execChannel 只发送 sudo -S -p '' -- 加原命令，在监听器注册后通过 ClientChannel.end 发送密码和换行，保持原管道 EOF 语义。

真实测试又发现首次 sudo 的提示文字因 2>&1 被合并进命令标准输出。移除该重定向，stdout 保持命令实际字节，stderr 保留 sudo/命令诊断；同时移除基于提示前缀截断 stdout 的逻辑，避免损坏恰好以该文字开头的文件。公开函数签名及退出码契约不变，没有新增共享抽象、依赖或授权入口；手工 sudo 与 AI/MCP 授权边界不变。

## 验证

sudo-exit-status 测试 5 项通过：缺失、空、零和非零退出码均保留；发送的 exec 字符串不含密码；标准输入恰好一次；包含类似 sudo 提示且带 NUL 的 stdout 内容完整保留，stderr 独立。

真实 Linux SSH 测试 1 项通过（含多个断言）：清除认证缓存后 sudo -n 被拒绝；错误密码失败；正确密码经标准输入执行 id -u 返回 0；root 创建受限文件，普通用户删除失败且文件仍在，显式提权删除后文件消失。捕获所有 exec 命令确认不含正确/错误测试密码。结果 .cache/sudo-stdin-linux-results.json，2 文件 6 项通过。临时受限文件及目录由夹具清理。

隔离实例 b37e197c-a55c-4374-89b4-66aea4aaca38，网络保持 restrict=on。首次在线安装 sudo 因 DNS 隔离失败，未计为通过。随后从 Alpine 官方 HTTPS community 仓库下载 sudo-1.9.17_p2-r1.apk，经 SFTP 传入该实例，以 apk --no-network 安装，保留默认签名校验，没有使用 allow-untrusted。实例现有 doas 仅用于测试环境配置；sudoers 专用规则要求密码并经 visudo -c 验证。无日常主机或用户配置改动。临时在线安装 launcher 改动已撤回，默认实验环境不变。

测试命令需先在专属实例离线安装 sudo，再设置 TANDEM_LINUX_MANIFEST 和 TANDEM_LINUX_SUDO=1；常规 CI 未启动该环境时明确跳过，不冒充真实 sudo 已运行。

本轮首次单位测试发现密码发送位置误置于 error 回调，已修正后通过；真实测试首次受 sudo 提示污染失败，修正 stdout/stderr 后重新通过。尚未完成实际桌面输入 sudo 密码与批量部分失败完整验收，B09 保持未全部完成。已发布 alpha.8 不包含本次后续修复。
最终 tsc -b、ESLint、git diff --check 均通过。专属实例经 QMP 关闭，启动器退出 0。

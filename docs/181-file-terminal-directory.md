# 文件目录打开终端的路径修复

2026-09-12。按 B11 核对“在此目录打开终端”时发现：根目录下文件的父路径被 substring 算成空字符串；后端初始 cd 使用双引号，POSIX 路径中的命令替换仍会展开。

## 实现与责任

file-terminal-path.ts 是文件菜单内部的路径规则：POSIX 根目录文件返回 /，Windows 驱动根目录文件保留尾部斜杠；只有 Windows 驱动路径把反斜杠作为分隔符，POSIX 文件名中的反斜杠保持字面值。上下文菜单通过该入口计算文件父目录，所选单目录仍传原目录。

hosts/terminal/initial-directory.ts 只构造初始目录命令，归终端模块所有。POSIX 使用单引号字面值和 cd --；交互终端控制字符拒绝。Windows 驱动路径使用 cmd/PowerShell 均支持的 pushd，避免 CMD 跨驱动器时只改目标驱动工作目录却不切驱动；在未确定远端 Shell 方言时拒绝 $、反引号、百分号、感叹号、引号和通配符等展开字符。

终端服务捕获无法表达的路径并返回 UNSUPPORTED_TERMINAL_PATH，不再发送目录命令或后续 executeCommand。界面有中英文错误说明。路径不再直接拼入可展开双引号。两个新辅助模块各属于本功能，不放入通用 utils，也不引入跨业务私有依赖；未新增外部包。

## 验证

两个文件 20 项通过：
- 实际 Bash 执行带中文、单引号、命令替换、反引号、分号和 & 的目录切换，目录内 marker 可见，额外命令目标不存在。
- 真实 Windows CMD/PowerShell 进入含中文、空格和单引号的目录，验证 marker。
- 控制字符与不安全 Windows 展开路径拒绝。
- 父路径覆盖 POSIX/Windows 根目录、普通目录及 POSIX 字面反斜杠。
- 实际 React 上下文菜单将 /file 的“在目录打开终端”回调参数设为 /。

首次 Windows 测试因 Node 对 cmd /c 的参数转义方式失败，已改为正确的 CMD 命令行测试包装；正则 lint 的无用转义已修正。中文缺失键 0。

本轮没有完整桌面 SSH“打开目录终端”验收，也未声明任意远端 Shell 方言均可安全表达所有 Windows 文件名。B11 的复制远端路径、可信 cwd 跟随、打开本地下载目录及真实目录联动仍需逐项验证；不把这次修复视为 B11 全部完成。公开 alpha.8 不包含本轮后续修复。
最终 tsc -b、ESLint、git diff --check 均通过。

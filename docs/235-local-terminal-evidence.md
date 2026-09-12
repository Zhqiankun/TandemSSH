# F15 与 B16 本地终端证据归并

重新对照 01-product.md 的 F15“Windows PowerShell / 可选已安装 Shell，用于本机命令与上传前检查”及 09-base-features.md 的 B16。F15 索引仍声称缺少 Shell 选择、起始目录和身份界面证据，但 B16 已通过 180 的实际实现与 Windows 验收，属于索引未同步。

本次重新读取当前 electron/local-shell.cjs、LocalTerminal.tsx，以及真实报告 `.cache/desktop-observation-report-08634703-885d-4243-a146-b5be33eac2fc/local-terminal-result.json`：

- Windows 默认 PowerShell 和 CMD 选择均存在；本机身份常驻显示，实际 Shell 路径/工作目录由 IPC 返回。
- 空目录使用用户主目录，非绝对/不存在目录拒绝；中文及带引号、$(literal) 的起始目录作为独立参数，实际子进程读回相同路径。
- 用户编辑设置不自动重建 Shell，点击显式重启才生效。
- 真实 Windows Electron/PTY 报告确认默认主目录、CMD、字面目录、本机标识和无效目录拒绝。

当前发布门禁已再次通过完整本地源码回归，未发现此模块新增行为修改。按原始 F15 范围标为 verified，引用 B16 已有直接证据；不是新增一次桌面测试，不将 WSL 发行版运行列为本次实测，也不缩小其他终端/文件验收项。

A27 等父任务协作验收仍按自己的具体证据范围继续，不因本地终端完成而合并标记。完整项目目标保持未完成。

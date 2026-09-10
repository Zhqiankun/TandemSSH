# Windows 桌面优先要求复核

2026-09-11，按原始 R02“第一版必须在干净 Windows 环境安装、打开和使用”复核。该项不包含稳定发行渠道、全部历史数据库迁移或第三方许可清单；这些工作继续保留在对应发行/升级范围，不能用它们重复阻塞 R02。

核实的直接证据：

- `verify-windows-installation.ps1` 仅允许 GitHub 托管 Windows runner；安装前拒绝已有 TandemSSH 注册、配置和快捷方式。使用实际 NSIS 安装程序，检查注册、安装标记、原生模块，并启动真实 Electron。
- `.cache/upgrade-ci-34372828543/installation.json` 的 installed/native/desktop/upgraded/uninstalled/dataPreserved 均为 true、failures 为空。该归档的 `desktop.json` 显示 zh-CN、正确产品标题、databaseReady=true、installed=true，并包含实际中文更新对话框文本。`upgrade.json` 证明下载、原生确认、升级自动启动、所测流程/文件/UI 数据保留及正常退出。
- 较新的公开 alpha.1 Release [34506929299](https://github.com/Zhqiankun/TandemSSH/actions/runs/34506929299) 已重新核对：Validate source、原生模块检查、Windows 安装/升级/卸载步骤全部成功。公开 alpha.1 的 EXE、ZIP、latest.yml 存在，公开更新源的实际客户端检查见 [78](78-preview-auto-updates.md)。
- SSH、人机协同与 MCP 的实际操作证据继续按各自标准保留在 [56](56-linux-ssh-acceptance.md)、[64](64-jump-combined-acceptance.md)、[77](77-history-export.md)，不从“能打开窗口”推断所有功能完成。

结论：R02 可标记 verified；整个产品目标仍未完成。此结论限定已测试 Windows x64 和托管 Windows 环境，不声称支持全部 Windows 版本或其他桌面平台。alpha.2 当前仍等待其独立 Release 门禁，不能提前声称通过。

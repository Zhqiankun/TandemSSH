# 终端默认值与配色备份

状态：已实现用户终端默认值、配色库和主机外观备份，专项、全量及最终 Windows 可见画面验收通过。

备份版本 3 增加用户终端默认显示设置、配色库及主机终端外观。types/terminal-appearance.ts 定义无执行行为的显示契约；configuration-backup/terminal.ts 负责从既有 JSON 投影和恢复配色库；schema/repository 继续负责完整校验、预览指纹、事务和收据。未新增通用 utils，不依赖页面内部状态。

仅迁移字体、字号、间距、行高、光标、主题/颜色、滚动历史、响铃和对比度。背景图片路径、SSH agent、环境变量、启动命令及认证不进入显示契约；不将源机器资源位置当作目标机器可用资源。主机外观附着于新主机配置；用户默认值与配色库仅在明确勾选恢复偏好后写入，默认不覆盖。配色库追加新 ID，同名追加编号；主题颜色直接内嵌于主机/默认值，不依赖旧主题 ID。

用户级偏好与全局管理员 host_defaults 分开。本轮不修改实例级代理、凭据与自动采样默认值。新增字段在旧版本 1/2 中忽略并提示；版本 3 严格校验。预览后默认值/主题库或主机终端配置改变，必须重新预览。

验证：颜色/大小边界、未知执行字段排除、默认不恢复、明确恢复、同名和 ID 重建、主题库上限、幂等/回滚、预览失效、中文数量/范围说明与真实桌面重启后主题库和默认值保留。

## 已执行验证与实测范围

54 项专项通过，覆盖显示字段投影、执行/资源字段排除、空默认值、继承选择、颜色字面量、旧格式新字段隔离、主题库追加/重命名、新 ID、默认不恢复、明确恢复、预览失效、满额回滚和成功确认幂等。初次旧 HTTP 测试被操作系统分配到 Fetch 禁用的服务端口，出现 bad port，请求未到达应用；测试夹具已在高位端口区间分配，仅对端口占用重选，不重试业务断言。

首轮桌面 0e0cff97-3633-4e4d-b6f7-4b36afca2302 已完成下载、默认不恢复/明确恢复和重启数据检查，测试脚本停在未先进入 SSH 分组的终端导航。修正导航后，第二轮 196b76fd-7d8e-433f-b1cb-4410157e1bc7 完成数据及样式值核对，但截图显示侧栏折叠。该轮不计可见画面验收；现增加屏幕范围和 elementFromPoint 命中判据，避免隐藏 DOM 被算作画面通过。

本轮实测为配置迁移和主机编辑器终端预览，不将示例终端内容称为真实 SSH 命令执行。自动/协作执行核心保持既有全量回归与前轮 SSH/MCP 证据，不用配色截图替代。

## 最终验证

最终全量回归 503 个文件通过、1 个跳过，3578 项通过、12 项跳过，274.62 秒。命令 vitest run --exclude src/backend/tests/collaboration/pty-integration.test.ts --maxWorkers=2；独立 ConPTY 门禁仍由 CI 单独执行。类型、构建及 lint（0 错误/既有 100 警告）通过，中文词条缺失 0。之后只把实际画面里的 Custom 名称接入已有动态中文词典，最终打包和原生画面再次复验。

最终证据 .cache/desktop-observation-report-a8c523d3-20fe-4d9f-9b66-d6e6feea6390/terminal-backup-result.json 与同名 -restart 目录的 terminal-backup-restart-result.json。真实下载与预览完全一致；首次导入未勾选偏好，目标 11px 默认值及原配色库保持；再次明确勾选后恢复源 18px 默认值，配色库保留旧项并追加“自定义夜色 (2)”和新 ID。导入主机自身保留 22px/自定义配色及不继承用户默认值的选择，启动命令与 agent 行为未迁移。

应用正常退出并在同一隔离目录重启后，数据仍保留。通过实际 SSH→终端编辑导航打开恢复后的主机，屏幕范围/elementFromPoint 验证预览真正可见，字号为 22px、背景为 rgb(16, 24, 32)。最终下拉框显示“自定义”，并有专门断言。截图 terminal-appearance-restored.png。测试 SSH 连接和命令计数均为 0。

最终包四份项目/底座声明及 13 项原生依赖校验通过，3 项打包 MCP 测试通过，隔离 Codex 发现 38 工具。未调用模型或修改日常 Codex 配置。四轮隔离用户目录各检查 9 个配置/日志/数据库文件，未发现测试密码 UTF-8/UTF-16 明文；未解密数据库。所有测试应用已退出，监听端口释放。

日志 .cache/terminal-backup-tests.log、terminal-backup-regression-final.log、terminal-backup-types.log、terminal-backup-lint.log、terminal-backup-localization.log、terminal-preferences-backup-desktop-localized.log、terminal-backup-native-probe.log、terminal-backup-package-mcp.log、terminal-backup-privacy-check.json。

剩余范围：实例级管理员 host_defaults、本机活动 C2S 配置、其他尚未纳入的设置与完整 B15 验收。此阶段不迁移背景资源文件、认证、环境变量、启动命令或其他自动执行行为。

# 指纹变化阻断与信任记录保留验收

2026-09-13，A02。原始标准为“阻断连接；不会自动改写信任记录”，不要求在此条重复整个命令规则或认证组合矩阵。

当前补强 HostTrustService 回归：先人工确认旧指纹，保存完整记录快照；随后依次出现两个新密钥。未确认和明确拒绝后记录均逐字段不变，持久化写入仍只有首次确认的一次；原密钥仍有效。没有生产逻辑改动。

当前 5 文件 19 项通过：host-trust、host-trust-ssh、host-trust-http、真实 SQLite host-trust-repository、中文 HostTrustPrompt。真实 ssh2 握手测试在同一监听地址更换服务器密钥，新服务器认证计数为 0；明确更新后只能通过新连接成功。HTTP 参数/身份绑定和持久化屏障、失败处理保持通过。TypeScript、ESLint 通过。日志 .cache/host-trust-current.log / host-trust-current-tsc.log / host-trust-current-lint.log。

对照 23 的已有 Windows 实机证据，读取并核对本地原始记录：

- host-trust-after-approval.json：旧密钥 generation=1，auth=2，accepted=1。
- host-trust-changed-rejected.json：更换密钥 generation=2，auth 仍为 2，连接为 0。
- host-trust-changed-updated.json：人工更新信任后 auth 仍为 2，连接仍为 0，没有放行失败握手。
- host-trust-reconnected.json：主动新连接后 auth=4、accepted=2、连接为 1。
- host-trust-final-rejection.json：中文拒绝显示且不再错误显示正在连接；同一 profile 重启保留信任的记录见 23。

本轮没有新启动原生桌面，该部分证据明确来自 23；当前代码真实握手/数据库回归与新增完整记录不变断言共同覆盖 A02。首次添加测试时误用了 app/app 路径，未写入；更正路径后重新执行，最终计数包含新增测试。

据原始标准将 A02 标记 verified，总计 41/79。F02/B02 的认证、保活与重连完整矩阵仍继续验收，不把 A02 通过当作整个 SSH 连接功能完成。未提交、推送、打标签或触发 Actions。

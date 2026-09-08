# SSH 主机信任与人工确认

2026-09-08，已完成本轮实现与 Windows 隔离桌面验证。本轮覆盖普通 SSH、快速连接、文件连接和跳板首次信任，以及密钥变化后的停止与重新连接。原始完整功能和发行门槛继续保留。

## 行为与边界

- 首次连接必须进入当前用户的中文确认窗口；没有终端 WebSocket 也不能自动接受。
- 指纹使用原始 SSH 公钥的 SHA-256 / OpenSSH Base64 格式，不能把原始公钥十六进制误标为 SHA-256。
- 已确认记录按用户、主机配置作用域、规范地址和端口保存；保存的主机使用 host:<id>，快速连接使用 quick。不同主机配置即使使用相同内网地址也不合并信任；快速连接不借用其他用户或保存主机的记录。
- 旧底座的密钥字段只作为迁移时的对照，需要明确确认，不直接转换为已经人工确认的信任。
- 密钥变化立即拒绝当前连接。人工核对并更新信任后，必须重新连接，不能把正在失败的握手或旧控制权继续放行。
- 确认绑定请求 ID、指纹、旧记录版本和当前用户；并发确认、过期、拒绝或存储失败不能变成放行。
- 持久化成功后才认可新信任。信任变更独立于命令、文件和任务授权，MCP/模型没有签发信任的方法。

## 文件责任与依赖

- types/host-trust.ts：请求、信任记录、人工决策及结果契约。
- backend/hosts/trust/fingerprint.ts：地址规范化、SSH 公钥类型与指纹计算；纯函数。
- backend/database/repositories/host-trust-repository.ts：用户独立记录、比较版本更新和持久化屏障；仅通过数据库上下文操作本表。
- backend/database/db/schema*、迁移：新增信任表，不复用可被普通设置或主机配置导入覆盖的字段。
- backend/hosts/trust/service.ts：待确认请求、时限、并发与用户决定；不处理 SSH 密码或原始终端输入。
- backend/hosts/host-key-verifier.ts：SSH 验证器适配，不再包含快速连接/跳板/无 WebSocket 的放行例外。
- backend/hosts/trust/http-routes.ts / production.ts：可信人工身份与生产组合；API Key 拒绝访问决策入口。
- ui/ssh/HostTrustMonitor.tsx：全局中文请求与更新提示，覆盖终端外的连接。

依赖方向为各 SSH 连接入口 → 验证器 → 主机信任用例 → 信任仓储；界面通过人工 HTTP 契约作决定。新抽象属于主机身份领域，主智能体负责实现与验证。

## 验证要求

覆盖未知/已知/变化密钥、快速连接、跳板、无 WebSocket、跨用户与并发请求、错误指纹/旧版本批准、超时与断开、数据库读取或持久化失败、正确 SHA-256 显示，以及真实 SSH 握手中批准前不进入密码认证。完整自动/协同、MCP、文件和上传回归继续保留。

## 存储与请求契约

新增 tandem_ssh_trust 表，信任更新通过记录版本比较后写入。SQLite 各仓储实例共享读写屏障；完成数据库落盘前不释放等待中的握手。持久化失败时尝试恢复内存记录，并拒绝该数据库实例后续的信任读写，重新加载后再处理。数据库保存函数现在向关键调用方抛出失败，后台周期保存自行记录并处理异常。

首次/旧记录确认等待 45 秒；密钥变化的请求保留 5 分钟供核对，但当前握手立即失败。确认参数绑定请求 ID、指纹、预期记录版本、当前用户与核对标记；并发确认不能覆盖另一次已更新记录。等待连接关闭或请求到期后，即便此前的人工选择随后成功落盘，也只对未来新连接有效。

人工入口为 GET /host-trust/requests 和 POST /host-trust/decide，禁止 API Key 身份访问。AI/MCP 工具没有批准主机信任的方法；普通命令授权也不能替代服务器身份确认。界面轮询和 WebSocket 只负责提示，SSH 验证器没有旧式 accept 消息放行入口。

SQLite 0011_host_trust、PostgreSQL/MySQL 0015_host_trust 迁移与快照已生成。后两者同时补入此前已授权的 enable_session_logging=false 默认值，不主动修改已有记录的选择。本轮验证了 SQLite 迁移、实际仓储与各方言模式生成一致性，未将其当作 PostgreSQL/MySQL 服务器实跑的证明。

## 实际验证与复现证据

联合回归 **86 个文件 / 666 项通过**，日志 .cache/host-trust-regression.log，覆盖 AI、自动/协同任务、MCP、文件编辑、目录、上传、主机信任与数据库保存。最终包专项 **12 个文件 / 50 项通过**，日志 .cache/host-trust-final-native-tests.log，强制运行原生 MCP stdio 与临时 Codex 配置检查，没有修改用户日常配置。

真实 SSH 测试覆盖快速连接、保存主机、没有终端 WebSocket 的跳板首次确认、密钥变化、断开、并发、跨用户和持久化失败。HTTP 测试验证人工身份与参数绑定；中文组件验证完整 SHA256 指纹、勾选前禁用和更新后重连提示。

Windows 桌面使用本机 127.0.0.1 夹具、随机凭据和独立应用数据目录，经实际快速连接表单完成：

1. 未核对时确认按钮禁用；指纹与独立夹具计算一致；批准前认证请求数为 0。
2. 勾选并批准后出现真实测试终端，认证数增加；.cache/host-trust-before-approval.json 与 host-trust-after-approval.json。
3. 同一地址更换密钥后，当前连接拒绝，认证次数不增加；界面同时显示新旧指纹。
4. 更新信任仅改变后续连接的信任记录，认证计数保持不变；主动重新连接后成功。对应 changed-rejected、changed-updated、reconnected 三份 host-trust JSON 记录。
5. 正常退出并使用相同隔离目录重启，不再弹出确认且连接成功；.cache/host-trust-restart-result.json、host-trust-after-restart.json。
6. 最终包再次轮换密钥，显示中文拒绝原因且不再显示“正在连接”；拒绝后认证计数保持不变。证据 .cache/host-trust-final-rejection.json、host-trust-final-after-rejection.json 与 host-trust-final-prompt.png。

桌面验证发现并修正快速连接 Password/Key/Credential 硬编码、错误状态仍使用“正在连接”文案。终端收到结构化 HOST_TRUST_REJECTED 后停止自动重连，人工刷新连接仍可操作。首次验证曾因等待超过 45 秒而被正确拒绝，随后人工刷新成功；脚本曾早于快速连接懒加载组件就绪而找不到输入框，等待实际组件出现后重试，未将这些失败记为通过。

TypeScript、前后端构建、翻译键检查和模式检查通过；全库 lint **0 错误 / 102 警告**，本轮另修正两个原有测试文件的未使用导入与 const 错误。此前局部 lint 结果不能代表全库无警告。Windows 解包验证包构建通过，仍使用 npmRebuild=false，默认原生重编译缺少 Spectre 库的问题未解决。

测试应用与 SSH 夹具已退出，调试/夹具及被检查的应用端口全部释放，生成的明文夹具密码描述文件和表单填充脚本已删除；.cache/host-trust-cleanup.json。截图已检查，完整指纹可读且未截断。

## 剩余范围

本轮不等于完整 Linux/OpenSSH 认证、跳板与网络故障矩阵完成，也未实现完整的信任记录查看/撤销管理页。其他原始功能继续按 F01—F15、B01—B16 和发行门槛推进：下载、跨重启传输检查点、批量目录、AI/MCP 传输与文件流程、历史/草稿、统一凭据保护、监控/隧道、完整汉化及标准构建安装。未调用收费模型、访问用户实际服务器或公开发布项目。

# 文件所有者与组修改方案

责任人为主智能体。原始 B10 要求所有者/组修改须具备权限；当前 SFTP 列表只显示 UID/GID，无修改入口。本轮新增人工文件属性操作，不扩展 AI/MCP 文件授权范围。

契约：POST /ssh/file_manager/ssh/changeOwnership，JSON 为 sessionId、path、uid、gid；UID/GID 必须是 0—4294967294 的整数，不接受名称、负数或 SFTP 的“不修改”哨兵。调用方使用现有会话 API 适配器，身份来自现有认证上下文，验证 SSH 会话归属后执行。返回 success 与实际读回 uid/gid/mode，失败返回稳定错误码，不自动重试、不自动提权。

模块：ownership-route 负责协议和会话授权；ownership-service 拥有 chown 调用、超时及 SFTP 读回。使用 chown -h 只修改选中链接自身，不自动跟随最终符号链接；单引号字面量转义用于 exec 通道，不经过交互式终端。UI 独立 OwnershipEditor 承担 UID/GID 输入与保存反馈；PermissionsDialog/文件管理页面仅编排，与 chmod 分开保存。依赖方向为 UI → API → 路由 → 文件用例 → SSH/SFTP；后端不依赖 UI，未新增数据库迁移或无业务归属共享工具。

验收：UID/GID 范围、会话归属、字面路径、失败/超时不报成功、读回不一致拒绝；中文输入/重复点击/失败保留；真实 Linux 普通用户合法修改与无权修改，以及实际 Windows 属性界面。chown 可能由远端系统清除特殊权限位，界面刷新实际状态，不自动补回。

## 实现与专项结果

接口、用例、API 适配、中文 OwnershipEditor 和文件属性对话框已接通。UID/GID 独立保存，原 chmod 流程保持；执行成功后刷新属性。execChannel 增加可选 beforeOpen 回调，在通道排队完成、调用 client.exec 之前检查有效性；其他调用方不传参数时行为不变。该公开可选参数仅由所有权用例使用，避免请求超时后迟到执行。

4 文件 / 34 项通过：参数范围/身份、字面路径、远端失败、读回不一致、超时关闭、不重试、真实通道队列发送前拒绝、中文校验/失败保留及重复提交保护，并回归原权限对话框。类型检查通过；修改文件 ESLint 0 错误、1 项原 FileManager 未使用 windowId 警告；静态翻译键无缺失。证据 .cache/ownership-tests.log、.cache/ownership-final-types.log、.cache/ownership-lint.log。

尚未完成真实 Linux 所有权修改/权限拒绝与 Windows 属性界面验收；本次改动不包含在已公开 alpha.2，暂不宣称完整 B10 完成。

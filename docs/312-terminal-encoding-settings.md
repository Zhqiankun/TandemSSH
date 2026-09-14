# 主机终端编码配置界面

2026-09-13，承接 311。HostEditor 增加“终端字符编码”选择，UTF-8 / GB18030 / Big5 / Shift_JIS，中文说明必须匹配远程编码、修改后重新连接。HostEditorData 显式读取、保存编码，缺省或旧配置回退 UTF-8；SSH 连接沿用既有 terminalConfig 传输，311 的后端从中读取编码。

共享契约归属 src/types/terminal-encoding.ts，只有四种允许值、类型和兼容解析。前端表单与后端编码模块均单向依赖该契约；类型层不依赖 UI、SSH 或 iconv。原 backend/hosts/terminal/encoding.ts 继续负责实际字节转换，兼容导出原入口。TerminalConfig 增加可选编码字段，无数据库迁移。

启动目录/启动命令已有 TERMINAL_INPUT_NOT_REPRESENTABLE 错误现在显示中文 toast 后返回，不作为断线原因。普通人工/AI 输入的转换拒绝还会被 SessionControl 既有写入异常边界保守归为 RESULT_UNKNOWN；需要后续增加明确的写入前校验契约，不能在通用写入异常处理中擅自把结果未知改为未执行。此限制尚未完成，不据此声称所有编码错误都已有精确提示。

验证：四种编码表单→保存 DTO→重新编辑均保持值，旧主机默认 UTF-8；与后端编码及会话适配器共 3 文件 80 项通过。日志 .cache/terminal-encoding-ui-tests.log。首次 TypeScript 因 NodeNext 导入缺少 .js 扩展名失败，已修复。尚未重新构建目录包或执行四编码实际桌面矩阵。

下一步：完成控制网关写入前编码校验、审查其他非 ASCII 写入路径，验证数据库保存和真实 SSH 字节/中文界面。F03/B03 未完成，整体 44/79；未提交、推送或触发 Actions。

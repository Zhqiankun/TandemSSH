# 桌面新建与文件错误契约

2026-09-12，延续文档 135 的真实 SFTP 验证。

首轮 Windows 桌面报告 .cache/desktop-observation-report-7db9337a-523a-4031-b456-ace661ce8258：从中文“新建”菜单创建含单引号的中文文件和中文目录成功，独立 SFTP 与列表均确认目标存在；同名冲突等待失败。

定位：ssh-file-operations-api 的 handleApiError 将409转换为只含通用 CONFLICT 的 ApiError，丢失 response.data.error；FileManager 基于 FILE_TARGET_EXISTS 的中文提示无法命中。新增 api/file-operation-errors.ts 专属文件错误适配：仅在400/409/500及已知文件结果码时保留最小 status/error，避免复制 Axios config 或认证头；其他错误仍走既有通用处理。创建文件/目录、复制、重命名、移动五个调用方使用同一适配。通用 main-axios 不反向依赖文件业务。

6 项 API 回归通过：实际五个导出函数能保留冲突结构，错误对象不带请求头/config；无关认证错误继续通用处理。新模块仅归属文件操作 HTTP 适配，独立测试入口为 src/ui/tests/api/file-operation-errors.test.ts，不引入跨业务 shared 抽象。

修复后的桌面复测结果待补充。alpha.6 已发布标签保持不变。

## 修复后桌面验收

报告 .cache/desktop-observation-report-9573f3be-7e21-48fc-bce1-eaded6b4c6c6/create-desktop-result.json。Windows 本地新构建目录包（版本元数据 alpha.6，包含标签之后改动）连接真实 Alpine 3.24.1 / OpenSSH VM 04db568c-b4c3-4c66-9bec-7642480c9be0；不同于已发布的 alpha.6 安装包。

从中文新建菜单及内联输入创建中文/单引号文件和中文目录，列表可见且独立 SFTP 确认空文件与目录类型。再次新建同名已有文件、目录，两个场景均显示“同名文件、目录或链接已存在，请换一个名称。”，独立 SFTP 确认原文件和目录子文件内容保持。create-file-and-directory.png、create-file-conflict.png、create-folder-conflict.png 已保存，目录冲突截图已查看。

客户端正常退出、后端端口释放，fixture finally 清理本次远端 UUID 目录。完整 tsc -b、build 和本地目录打包通过；新适配及测试 ESLint 无错误，既有 API 文件保留 buildFileManagerUrl 未使用警告。本轮不涉及公开发布，未修改任何版本标签。

B09 的新建普通文件/目录及同名冲突桌面链现有直接证据；完整批量删除、复制命名冲突、异常/重连矩阵继续验收，不据本次将整个 B09 标记完成。

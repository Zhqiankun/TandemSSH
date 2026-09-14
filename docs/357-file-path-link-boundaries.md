# 路径与链接边界验收

2026-09-14，A17。本轮没有修改生产代码、API、共享抽象或模块依赖。

## 新增真实Windows场景

下载根替换：在实际下载预览完成、确认前，将本轮已选本机根目录移动到同一报告目录的保留位置，原路径改为指向另一测试目录的Windows junction。所有移动、链接创建及恢复均先核对本轮明确路径边界。点击确认后出现中文目标变化错误；链接目标仅有原保留.txt，内容external keep不变；原目录没有新目标或下载暂存。之后核对链接身份，删除链接本身并恢复原目录。报告.cache/desktop-observation-report-b3f53632-3c65-424f-8a60-9bc06204153b/root-replacement-result.json，日志root-replacement-native.log。

上传来源链接：实际拖入的目录包含指向未选择目录的Windows junction。正常3文件/3目录经预览后完成，链接未上传。只对本轮客户端的fs.promises.open/readdir增加透明观察，匹配链接路径及实际外部根，读/枚举次数为0，外部文件内容不变。观察未改变文件操作结果。报告.cache/desktop-observation-report-86a5fcaa-d261-4617-8b23-db6845462674/native-drop-result.json，日志source-link-native.log。

两个场景均为独立Windows客户端、真实loopback SSH/SFTP，正常退出且脚本exit0。目录选择器只固定返回本轮目录；上传使用真实路径CDP拖拽，不宣称人工资源管理器鼠标操作。

## A17 原始范围对应

原始验收：文件路径..、符号链接、目标被替换，正确拒绝或检测冲突，记录不能防御的远端竞态。

- 路径..与规范路径：file-gateway测试拒绝/srv/../etc/passwd、相邻前缀/srv-extra，以及请求路径允许但规范路径位于/etc的情况；在后续I/O前再次解析到越界路径时读次数0。此部分是实际网关配受控执行端口，不冒充真实远端攻击全矩阵。
- 本机来源及目标链接：本轮两项真实Windows证明；download-directory-targets真实文件测试另拒绝../escape、盘符路径、保留名、大小写重复映射，并在确认后目录被junction替换时拒绝文件准备。
- 远端链接与替换：upload-trees真实SFTP测试在目标目录确认/准备后移走原目录、改链接到/outside，start返回FILE_TARGET_CHANGED且外部目标不存在；download-trees真实SFTP扫描将链接标为DOWNLOAD_TREE_LINK_SKIPPED，不解析链接或枚举外部secret。
- 文档目标重校验：document-service包含连接变化与链接改指拒绝；356恢复写入前检查目标基线及真实桌面变化拒绝，355同大小同时间内容变化拒绝。权限和删除更具体作用目标另有265/A34实测。
- 竞态限制：17明确摘要/属性核对不是跨进程原子compare-and-swap；DNS别名、硬链接及外部进程不构成全局锁。263/265明确最终链接检查与chmod之间仍有竞态；356保留提交前再次核对，但不承诺消除检查后外部修改。

本轮联合运行file-gateway、document-service、upload-trees、download-trees、download-directory-targets、upload-sources，6文件97项通过，无跳过，日志.cache/path-link-boundary-regression.log。结合上述直接场景与限制记录，A17标记verified。

不把本结论称为防御所有外部并发、所有文件系统或所有服务器的绝对隔离。未推送Git或触发Actions。

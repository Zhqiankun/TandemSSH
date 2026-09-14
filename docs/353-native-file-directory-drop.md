# 外部文件拖拽路由修复与真实目录验收

2026-09-14，继续B05/F09。

## 缺口与边界

实际把本机文件夹和文件拖到远端文件图标上时，FileManagerGrid.handleFileDrop先阻止冒泡，随后因并非内部拖拽直接返回；上传预览没有出现，外部拖拽遮罩仍保留。容器原分支还只传FileList，单目录拖拽可能丢失交给useDragAndDrop识别目录的入口。

FileManagerGrid新增可选onExternalDrop公开回调。图标和网格对外部File负载清空拖拽状态并同步转交原事件；FileManager将现有dragHandlers.onDrop连接该回调，useDragAndDrop继续拥有验证和FileSystemEntry/真实File捕获，UploadTreeDialog继续负责预览。没有新建上传引擎或本地路径能力，内部远端移动仍经过原会话/目录scope校验。外部目标仍由当前目录及预览明确展示，不隐式改成被悬停目录。

图标上文件/目录两项失败回归修改前均失败；修复后网格内部拖拽、范围失效与拖拽hook合计2文件12项通过。TypeScript与build通过；ESLint零错误，FileManager.tsx已有windowId未使用警告仍存在。日志grid-external-drop-before.log、grid-external-drop-after.log、external-drop-tsc.log、external-drop-lint.log、external-drop-build.log、external-drop-package.log。

## 真实Windows复测

本轮独立目录版客户端、真实loopback SSH/SFTP，用CDP Input.dispatchDragEvent传入真实本机目录与文件路径，由Chromium产生拖拽负载，经过Electron原生来源能力和实际传输；不是new File伪造内容，也没有直接调用上传API代替drop。没有声称人工在Windows资源管理器里拖鼠标。原生目录选择器只固定返回本轮本机面板根，拖入对象不依赖该选择器。

- 混合拖入拖拽目录与独立 %.txt，预览显示3文件/3目录；包含子目录/深层 %.txt、根.txt及空目录。
- 确认前远端目标不存在；确认后6项完成，每个文件实际内容正确、空目录存在且为空。
- 再单独拖入一个目录，仍进入目录预览；更名为单目录拖拽并重查，深层文件和空目录正确落盘。
- 中文预览截图已查看，深层目标路径与空目录显示正确。滚动区域不保证所有行同时可见。

成功报告.cache/desktop-observation-report-000992e9-047d-4c3f-b4ec-ebe9f91d4793/native-drop-result.json；日志.cache/native-drop-fixed.log。脚本.cache/run-native-drop.cjs、native-drop-scenario.txt。客户端正常退出，脚本exit0。首次未修复的失败记录保留在native-drop.log及其报告。

## 剩余

当前本地目录包包含此次修复，公开版本未变。B05还需归并原条款完整证据；后续补深层目录下载与拖拽大小/类型错误的中文提示（hook目前仍有英文字符串）。整体保持49/79；未推送Git或触发Actions。

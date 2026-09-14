# 拖拽错误汉化与深层目录往返

2026-09-14，继续B05/F09。

## 汉化修改

useDragAndDrop的文件大小与类型校验原来返回固定英文。现在通过现有react-i18next读取fileManager.dropFileTooLarge、dropTypeNotAllowed和dropUnknownType；错误提示仍由既有onError交付，不改变大小限制、类型判断或上传权限。useCallback包含t依赖，切换语言后采用当前翻译。

英文、简体、繁体提供对应文案，其他语言暂使用英文回退文本。没有新增共享抽象、API或业务层依赖。测试实际挂载中文I18nextProvider，核对超限文件名/上限、未知类型提示，并确认被拒文件不触发上传。

拖拽hook和网格回归2文件13项通过；TypeScript、ESLint、翻译键检查通过，缺失键0。日志drag-errors-tests.log、drag-errors-tsc.log、drag-errors-lint.log、drag-errors-locales.log。构建日志deep-tree-build.log；仅生成本地验收目录包，不发布。

## 当前桌面深层目录往返

本地验收包构建与打包成功后，独立Windows客户端连接真实loopback SSH/SFTP。复跑353的真实路径CDP拖拽：混合目录/文件、单目录拖拽均通过预览并写入正确；再选择上传后的拖拽目录下载到本机已选根目录，明确改名为下载深层目录并重新检查。

确认下载前目标目录不存在，确认后子目录/深层 %.txt准确为“深层中文内容”，根.txt准确为“root bytes”，空目录存在且为空，下载队列5个目录/文件条目全部完成。没有直接调用传输API代替UI操作；原生目录选择器仅固定返回本轮测试根，CDP拖拽使用真实File/目录路径，未宣称人工操作Windows资源管理器。

报告.cache/desktop-observation-report-d64a4bd0-c68f-4483-9833-41dc77e85978/native-drop-result.json已读取，包含deepDirectoryDownload、downloadFiveItemResults、roundtripContentsVerified全部true。日志.cache/deep-tree-native.log。脚本.cache/run-deep-tree.cjs、deep-tree-scenario.txt。客户端正常退出并释放端口，脚本exit0。当前目录包包含353拖拽路由和本轮汉化；公开Release未更新。

## B05 原始条款完成审计

原始验收：单文件、多文件、文件夹递归、拖拽、目标选择、传输前预览和逐项结果。

| 条款 | 直接证据 |
| --- | --- |
| 单文件 | 351下载、352上传当前桌面单项完整生命周期与实际内容校验 |
| 多文件 | 349/350双向五文件真实桌面调度、独立目标与字节一致 |
| 文件夹递归 | 353深层上传，本轮深层下载往返和空目录；347双向目录冲突路径 |
| 拖拽 | 353及本轮真实路径CDP混合文件/目录与单目录拖拽，经Electron来源能力实际传输 |
| 目标选择 | 334本机面板实际目标选择/路径导航，347本机和远端明确目标目录及改名重查，本轮下载新目标 |
| 传输前预览 | 347/348冲突预览与授权边界，353及本轮确认前目标不存在 |
| 逐项结果 | 349/350多项完成，351/352暂停取消失败恢复；本轮上传6项及下载5项结果与实际内容对应 |

据原始范围仅B05标记verified，整体50/79。F09整体文件管理、其他高级功能与最终发布继续保留。此次未推送Git或触发Actions。

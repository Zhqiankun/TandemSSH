# Windows 实际上传运行中并发调整

2026-09-14，继续B06/F09。测试服务器beforeRead/beforeWrite钩子增加remote参数，调用方可按真实SFTP文件区分请求；既有无参数回调保持兼容。该接口只属于backend/test-helpers，不进入产品调度、API或UI依赖，没有新增共享抽象。

当前win-unpacked桌面实例通过真实目录选择/上传预览/队列和SSH/SFTP传输五个不同文件，每个128KiB加1至5字节，填充内容各不相同。目录选择器仅替换成返回本轮测试目录；每个SFTP临时文件的写入由独立promise门控，传输顺序依据真实服务端请求和实际完成状态。

先加入一个文件，在面板“同时上传”设为1，再加入其余四个文件。上限1时只有一个文件出现SFTP写请求；改为3后出现三个独立临时文件写请求。改回1后释放其中两个文件，等待二者真实完成，第四项未开始，现存第三项没有被暂停或取消。释放第三项后第四项启动，第四项完成后第五项启动。最后五项完成并逐字节与原始来源比对，报告保留每个文件SHA256。

最终报告：.cache/desktop-observation-report-3fb56c8a-e9e5-4097-8bd2-9eb297f5c6b9/upload-concurrency-result.json。日志.cache/upload-concurrency-native-v2.log。脚本.cache/run-upload-concurrency-native.cjs、upload-concurrency-native-scenario.txt。实际客户端正常退出，执行脚本exit0。

首次脚本失败原因是先把五项加入队列、再设为1，却把产品默认上限误当成1；错误是验收顺序，不是调度故障。原日志.cache/upload-concurrency-native.log保留。第二次改为用户可执行的先加入一项并设上限、再追加四项，未修改默认并发或产品调度规则。

原上传队列和真实SFTP目录上传回归共2文件27项通过；类型和规范检查日志upload-concurrency-helper-tsc.log、upload-concurrency-helper-lint.log。没有重建或发布安装包：唯一源码变更是外部测试服务的观察钩子。

此证据补齐上传运行中并发的实际桌面路径。B06仍需下载侧实际桌面动态并发，以及完整暂停/恢复/取消/重试等已有证据按原条款归并审核；整体48/79，不将上传成功推广成双向传输管理全部完成。

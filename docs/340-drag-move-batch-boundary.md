# 拖放移动复用受控文件批次

2026-09-13，继续F09/B09。handleFileDrop此前自己循环moveSSHItem，单项异常被内部catch吞掉后继续移动后续文件，且没有在连接准备后与每项之间核对会话。339只保护drop前的范围变化，不能替代这一执行期检查。

现在捕获操作会话/源目录，对非原地no-op条目通过现有runFileBatch顺序执行；连接准备前后及每项前后用assertFileSession核对当前会话和挂载状态。首次未确认结果或会话变化停止后续项，不重试、不宣称回滚。

只有moveSSHItem明确成功返回才生成fileActionReceipt。批次中止后，已确认条目仍保留带原会话ID的撤销记录；失败/未执行项不进入撤销凭据。中文提示显示“已确认 completed/total”，明确未确认项需核对远端状态。finally使原目录和目标目录缓存失效，只有用户仍在原会话/原目录时刷新和清空选择，避免改动新会话界面。

职责：FileManager负责UI编排、回执和提示；顺序/遇错停止继续由既有file-batch模块负责。没有新增共享模块或后端协议。2文件13项批次和网格回归通过，TypeScript、ESLint及翻译键检查通过。日志 .cache/drag-move-batch-tests.log、drag-move-batch-tsc.log、drag-move-batch-lint.log、drag-move-batch-locales.log。

未重新打包完成真实SFTP拖放移动的部分失败/断线实机矩阵，不能据公共批次测试认定整个B09通过。整体46/79，未推送或发布。

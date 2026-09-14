# 终端编码的写入前拒绝与未知结果边界

2026-09-13，承接 312。SessionControl 原来将 transport.write 的所有异常保守视为 RESULT_UNKNOWN；这是正确的传输失败处理，不能靠异常文本认定零字节写入。

SessionWritePort 新增可选 validateWrite(data) 契约：同步、无副作用、不得写入传输。SessionControl 在实际 write 的 try/catch 之前调用；已有适配器不提供该方法时行为不变。终端会话适配器在此执行编码可表示性检查，失败转换为 ControlError(TERMINAL_INPUT_NOT_REPRESENTABLE)。实际 write 中仍进行最终编码和原控制权复核；任何实际写入异常仍触发人工接管及 RESULT_UNKNOWN，不自动重试。

人工输入仍先撤销自动控制权，即便该次字符无法编码；失败不会写出字节，后续合法人工输入可继续。操作网关现有 sent 标志在 commitWrite 成功后才置位，因此明确预检拒绝得到 cancelled-before-send。没有修改通用未知结果归类。

前端终端识别 collaboration.error 的此特定编码错误，显示既有中文未发送提示后返回；历史和操作视图的协作错误词条同步添加翻译。其他协作错误处理不变。

模块责任：控制层只定义通用预检契约，不依赖 iconv 或编码实现；终端适配器负责编码预检。共享错误联合类型增加一个值，无数据库迁移、异步准备或新 SSH 连接。

验证：4 文件 188 项通过。具体包括 AI/人工编码拒绝后 SSH write 为零、人工接管使旧租约失效、合法后续输入成功；自动和 collaborative 模式的网关均记录 cancelled-before-send + 对应错误码；即便实际 transport.write 抛出同名错误，仍必须是 RESULT_UNKNOWN。日志 .cache/encoding-preflight-final.log。

四编码真实 SSH 和中文桌面矩阵尚未执行；不据单元测试认定完整终端编码功能已验收。F03/B03 未完成，整体 44/79，未推送或发布。

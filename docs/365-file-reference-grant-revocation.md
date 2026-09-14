# 接管后更换只读授权不能复活旧文档引用

2026-09-14，继续A18撤销边界。新增自动/协作两种模式回归，使用已有MCP主体文件任务及共享FileAutomation、TaskRuntime、DocumentService；文件IO为受控内存夹具，没有新增产品代码、API或共享抽象。

先授权/srv读写并读出/srv/config的版本引用；人工接管后旧引用不可访问。随后人明确重新授权到另一个/other只读目录：旧版本内容读取及旧版本修改提案均返回FILE_CONTEXT_EXPIRED，/srv/config仍为port=80。新授权的/other/config通过同一执行链读取成功；协作模式仍须独立批准，SSH端口没有业务命令写入。

这不是新目录范围是旧范围数学子集的测试，而是原路径授权已移除、另一路径仅授予读取时的引用失效测试。它同时验证拒绝旧权限与允许新权限，避免把全部访问都拒绝当成成功。没有把MCP主体路径描述成新的内置AI桌面实测。

automated-documents共16项通过，日志.cache/file-narrower-grant-tests.log；TypeScript及ESLint通过，日志file-grant-revocation-tsc.log、file-grant-revocation-lint.log。

与363/364组合补充不可用工具、受支持工具越界及重新授权后的旧文件引用边界。A18真实桌面恶意来源展示与整体安全场景仍需完成，暂不标记通过。整体56/79，未推送Git或触发Actions。

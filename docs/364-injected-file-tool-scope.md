# 恶意输出通过受支持文件工具尝试越界

2026-09-14，继续A18。本轮新增验证，不修改产品工具、权限、API或业务依赖。automated-files-fixture仅增加可选terminalOutput，原调用默认行为保持不变。

模型实际收到受控readOutput提供的恶意文本，并主动调用当前工具列表内真实支持的read_file。人工只授权/srv目录的read访问，测试组合为自动/协作×三类路径：/srv/../private/key越界、/srv-neighbor/key相邻前缀、/srv/link解析到/private/key。第三类通过受控RemoteFileIO.resolve模拟规范路径变化，不声称创建了真实系统链接。

六种组合均进入paused-error，任务错误为FILE_SCOPE_EXCEEDED；文件snapshot内容读取端口调用0次，模型请求中没有合成私密标记，未派发SSH命令，maxTurns仍4，控制权human。协作路径若先出现待批准状态，则批准请求的表面路径后仍由规范路径守卫拒绝；不把对名义路径的批准当作对任意解析目标的授权。

第一轮测试错在操作记录上查原始拒绝原因，看到STALE_CONTROL。检查实现和实际状态后确认：越界触发任务暂停，撤销未执行操作的控制权；原始FILE_SCOPE_EXCEEDED保留在任务层。改为要求任务明确保留该原因，仍要求内容读取0次，没有放宽成接受任意失败。

与363的不可用工具回归联合2文件25项通过；补充human控制权断言后文件任务8项通过。TypeScript、ESLint通过，日志ai-file-scope-injection.log、ai-file-scope-injection-v2.log、ai-file-scope-final.log、ai-file-scope-control.log、ai-file-scope-tsc.log、ai-file-scope-lint.log。

证据范围为实际AiTaskCoordinator、FileAutomation、TaskRuntime、DocumentService与受控模型/文件/SSH端口。测试未读取真实本机私钥，合成标记仅在测试内存文件映射中。A18仍需当前真实桌面来源说明和完整撤销组合归并，不提前标记完成。整体56/79，未推送Git或触发Actions。

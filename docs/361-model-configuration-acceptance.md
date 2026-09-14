# 模型配置表单的当前 Windows 验收

2026-09-14，F05。当前工作树重新build并打包，包含360探测结果绑定修复。本轮没有追加生产代码或共享抽象。

## 实际表单到模型调用

独立Windows客户端，先通过测试用户偏好开启AI，再从实际界面添加“OpenAI兼容接口”。在真实表单填写配置名、自定义接口URL和测试Key；未通过providers API代替表单保存。

- A接口的模型列表请求被测试端点挂起，表单改为B接口后显示model-b；随后放行A的obsolete-model迟到响应，当前建议仍为model-b。
- 从模型下拉框选择手工输入，填写custom-model，点击刷新列表；实时探测B接口成功后手工模型仍保留。
- 点击保存，真实后端记录为B的URL、openai_compatible类型和custom-model；提供商读回不包含完整测试Key。
- 用新配置在实际聊天输入框发送“配置表单验收”。测试端点核对两次模型请求均使用正确Authorization和custom-model。
- 第一次SSE响应包含list_hosts工具调用，应用执行只读工具，第二次模型请求携带工具结果并返回“配置连接成功”。真实后端助手历史保存了fixture-form-tool对应的工具消息，不能仅凭文本回复算工具调用成功。

报告.cache/desktop-observation-report-79c1243b-4799-411a-baaa-2324e351167d/model-form-result.json已读取，全部断言通过，实际模型请求2次。日志model-form-native-v3.log，脚本run-model-form.cjs、model-form-scenario.txt。客户端正常退出、后台端口释放、脚本exit0，两个URL由同一独立本地HTTP服务的不同路径提供，不调用商业模型。

前两次失败属于观察器导航：Page.reload返回后旧页面仍可能有“快速连接”，脚本提前开始操作，与新文档欢迎引导重叠。增加旧文档标记并等待新文档readyState完成后，再处理引导，完整场景通过；未修改产品引导或缩短产品检查。失败日志model-form-native.log和v2.log保留。

## F05 原始条款审计

原始验收：OpenAI兼容工具调用接口、流式响应、自定义URL/模型/Key、连接测试。

| 条款 | 直接证据 |
| --- | --- |
| OpenAI兼容工具调用及流式响应 | 本轮实际HTTP/SSE、真实list_hosts执行、第二轮携带结果、持久化工具消息；14/68/225另有自动/协作及工具历史证据 |
| 自定义URL、模型、Key | 本轮实际表单填写/保存及端点收到正确模型和认证；360异步列表和手工模型保留回归 |
| 连接测试 | 实际表单自动/手动刷新执行实时models探测，当前接口结果正确，随后真实聊天完成工具调用；68/271另覆盖网络及模型错误 |
| 保存可用性 | 本轮保存后实际请求；205的result.json本轮重新读取，确认Key保存、轮换、掩码及正常重启后可用 |

依据F05原始范围仅F05标记verified，整体55/79。只证明要求的OpenAI兼容路径，不把它推广到所有供应商适配器的商业端点兼容性。R06/F06执行任务轮次预算、授权和其他独立范围，以及A16系统加密故障组合仍继续验收。

构建日志model-form-build.log、model-form-package.log；360已有9项表单回归、类型和规范检查通过。本轮未推送Git或触发Actions，公开安装包未更新。

# 隧道查询与握手期间撤权

2026-09-14，继续F12/B13/A35。C2S原来只在解析主机前检查一次connect权限，异步解析或握手期间撤权后可能仍继续。

## 修复边界

c2s-relay.ts新增内部assertC2SAccess，使用已解析配置中的requestingUserId/sourceHostId向既有PermissionManager复查，并在异步检查前后检查AbortSignal。调用点：源连接开始前、代理建立后/SSH前、SSH握手完成后/转发前。检查失败时关闭本次已连接SSH及代理socket，保留原权限错误，不创建转发。

权限规则仍归PermissionManager；中继拥有连接和清理，未建立新共享模块或页面到后端依赖。页面只将既有Access denied错误映射为中文“没有建立隧道所需的主机权限，请确认权限后重试。”，不误报成功。

## 验证

新增查询挂起期间撤权测试：先确认实际进入解析，撤权再放行；修复前进入SSH.connect拦截器，修复后Access denied且connect零调用。日志.cache/tunnel-access-before.log。

新增真实回环SSH认证后撤权测试：权限夹具在服务端真实ready计数大于0时失效，主机信任仍由测试人工批准。认证完成1次，转发0次，真实SSH客户端连接最终0；不是只检查取消标志。两组后端含三模式/代理取消回归共63项通过，日志tunnel-access-complete.log。

中文组件验证拒绝说明且无成功toast；日志tunnel-access-ui-tests.log。前后端类型、修改文件ESLint及本地化检查另记录最终结果。

本轮不声明已建立并持续传输的隧道能立即感知后续所有撤权，也不替代全桌面注销/所有认证矩阵。修改尚未打包桌面验证。整体64/79，未推送Git或触发Actions。

最终中文组件7项通过，与后端合计70项；tsc -b、四处文件ESLint、本地化检查通过。日志tunnel-access-final-types.log、tunnel-access-lint.log、tunnel-access-localization.log。

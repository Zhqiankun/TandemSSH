# 隧道端口预检与中文错误

2026-09-14，继续F12/B13/A35。发现C2S local/dynamic打开路径只检查目标端口为正整数，没有65535上限；测试路径则在SSH建连后才检查local目标或remote监听端口。

## 修改

c2s-relay.ts在建立SSH之前拒绝越界目标端口；local/remote测试也先验证对应端口，再创建SSH客户端连接。保持原错误字符串与后续防御校验，动态测试没有单一转发目标，仍按其现有语义只验证源连接。

C2STunnelPresetManager已有错误展示入口新增四种端口错误的中文映射：提示有效目标地址和1–65535整数端口。简繁中文、英文及其他语言回退已补齐；失败后测试按钮可再次使用。

中继模块负责输入校验和连接生命周期，页面只翻译显示，不用前端检查替代后端边界。没有新增共享抽象或依赖方向。

## 验证

新增8个端口案例修复前均进入SSH.connect拦截器；修复后按相应Invalid错误拒绝，connect零调用。测试使用受控WebSocket接口和SSH.connect抛错探针，不冒充新真实网络握手。此前真实三模式中继数据与取消测试一并回归。

后端两文件61项通过；中文C2S组件6项通过，合计67项。前后端tsc -b、修改文件ESLint、本地化缺失键0通过。日志.cache/tunnel-port-before.log、tunnel-port-final.log、tunnel-port-types.log、tunnel-port-lint.log、tunnel-port-ui-tests.log、tunnel-port-ui-types.log、tunnel-port-ui-lint.log、tunnel-port-localization.log。

本轮生产修复尚未重新打包桌面；完整隧道权限与监听前取消仍待验证，整体64/79。未推送Git或触发Actions。

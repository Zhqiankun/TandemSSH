# 四类规则范围的组合与排列验证

2026-09-13，F07 局部验收。新增 policy-composition.test.ts，无生产逻辑改动。

固定期望表覆盖服务器匹配/不匹配、分组匹配/不匹配、任务匹配/不匹配八种目标。四组规则分别为全局允许、分组要求确认、服务器拒绝、任务严格空白名单。对全部 24 种规则排列同时检查命令、文件读取、文件写入（576 次策略计算）：目标范围正确选择，拒绝和严格白名单不被允许覆盖，确认不降为允许，返回版本及命中来源正确。

另对 read/write 检查全局 /srv 与服务器 /srv/app 白名单的交集，交换两组顺序。请求路径和解析后路径都位于 /srv/app 才允许；任一位于 /srv 其他位置或 /etc、通过 .. 离开子目录、前缀类似 /srv/application 均拒绝。传入的是用于策略评估的解析路径，未声称本轮连接 SFTP 实际解析了符号链接。

首轮 10 项因夹具复用了命令/文件规则 ID 而被 DUPLICATE_RULE_ID 拒绝。修正测试 ID 后通过，生产 ID 校验未放宽。

最终 4 文件 32 项通过，包括新组合测试、policy-schema、policy-persistence 与中文 PolicySettings；TypeScript、ESLint 通过。日志 .cache/policy-composition-final.log / policy-composition-tsc.log / policy-composition-lint.log。测试不产生远程执行，不代表真实桌面的保存、试算和旧授权撤销已全部验收。F07 继续保持 not-fully-verified，计数 37/79。未提交、推送、打标签或触发 Actions。

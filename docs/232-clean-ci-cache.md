# 干净 CI 的测试缓存初始化

前一开发提交 de1e9ba 的 CI 34693235668、Windows job 103552159852 失败：4221 项通过、15 项失败、24 跳过。15 项均为 collaboration/recovery/execution.test.ts 在 fs.realpath(workspace/.cache) 处抛 ENOENT，业务断言尚未执行。

根因：多个测试夹具需要工作区 .cache，但依赖其他测试先创建；本地已有缓存掩盖了测试运行顺序依赖。

修复 app/vitest.setup.ts：在任何测试前，以幂等 mkdirSync 建立工作区父目录下 .cache。没有删除或搬动已有缓存，没有修改生产应用或恢复逻辑。

独立复现使用 `.cache/clean-ci-6525d590-aa51-4209-9757-15d36675c3b8/app`：测试源码和依赖引用现有目录，独立 cwd 对应的 .cache 确认不存在。原 setup 下 15 项均以 ENOENT 失败；仅替换为新 setup 后 15 项全部通过，3.12 秒。日志 .cache/clean-ci-before.log、.cache/clean-ci-after.log。修复文件 ESLint、diff 检查通过。

alpha.13 标签 d9994df 已经推送，不重写标签。该测试准备修复在标签之后，不能声称被纳入 alpha.13 原标签；当时 Release 34693721741 仍处于 Validate source，发布结果需继续核对。

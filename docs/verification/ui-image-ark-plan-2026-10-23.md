# UI 生图直连与任务恢复核验（2026-10-23）

## 修复及兼容边界

现有外部工具执行器按 MCP requestId 派生内部操作命名空间，用于现有操作 ID。范围路由误把该命名空间当作 `ai_jobs.id`，所以真实 `image_generate` 在供应商请求前报“原始请求不存在”。修复使用独立的真实原任务 ID 查询正式输入；操作命名空间、请求占用和持久回执标识都保持原样。新增回归用例先复现 404，再证明生图、原始候选保存及重复 MCP requestId 拒绝，供应商模拟调用仅一次。

未新增 API/SDK 适配器、格式、迁移或默认值。审计发现的既有历史图片规格默认读取、重试链/检查点读取及缺失 token 计数处理保持现有规则，未删除、改写或迁移；原始厂商 usage 继续完整保留。

## 真实火山请求

用户指定 Agent Plan 端点及凭据后，使用现有适配器和独立合成账号/数据库，实际只发出一次图片 POST：

- URL：`https://ark.cn-beijing.volces.com/api/plan/v3/images/generations`。
- 模型 `doubao-seedream-5.0-pro`，显式规格 `doubao-seedream-5-0-pro-260628`，请求 2731×1536。
- HTTP200，首个响应头 63,354 ms；requestId `021792743995673023c86cf9fdd5b616907ba6841dcfa8ae26655`。
- 实际保存 PNG 2731×1536，5,627,082 字节，SHA256 `c17d2930d3b0f9c0aebed8becc7d8255e3a69302495f13086b2389837fcf5a08`。已实际查看：浅色阅读 UI、青绿色导航、阅读卡片、进度图和书籍推荐，属于完整位图。
- 厂商原始 usage：`generated_images:1`、`input_images:0`、`output_tokens:16386`、`total_tokens:16386`。保留原始用量，不推断套餐扣额或货币费用为零。

提供的 API Key 仅通过关闭回显的 stdin 进入请求认证内存，测试数据库仅保存合成占位凭据。无真实密钥写入代码、日志或发布包，无自动端点回退或第二次生图。官方配置依据为[火山 Agent Plan 视觉接入](https://docs.volcengine.com/docs/ark/agent-plan-personal-visual-models?lang=en)。

## 保存与恢复的实际范围

首轮已经完成数据库/runner 关闭重开、复用同一保存回执、授权 PNG 下载及字节核对；最后匿名访问断言误期望 401，实际为隐藏资源存在性的 404，故首轮脚本整体记失败并保留原回执。断言已改为当前真实约定，没有重新发出图片请求。

随后新进程重开同一数据库，通过生产回执函数和存储读取核验同一 asset/operation、原始候选及 PNG 字节。call/operation/asset 全部行保持一致，供应商调用为零；租约过期后也用已授权账号读取同一保存回执。`saved-recovery-2` 与 `saved-recovery-after-lease` 均通过。

另一次完整应用跨进程启动因首版脚本未保留随机测试主密钥，被既有指纹保护拒绝。没有重置指纹或数据来绕过；本次不宣称这个原数据库的完整应用跨进程启动通过。后续新测试脚本会以 0600 权限保留随机合成主密钥，真实火山 Key 仍不落盘。数据库回执/存储恢复与完整应用启动是不同核验范围。

原网关 HTTP504 的 job `d742f4c0-e427-4aa6-8206-ca9fc8d57dd4`、call `aae0625d-df9f-4118-8762-eb6cac1e5ff3`、operation `736a328e-1b47-43c0-a85b-a57bc3c0e717` 均未修改，原数据库 SHA256 仍为 `61ac3d2c716f7d89a0a89fe7a032d5174cf069f09eeeebc46d94669a6945d53f`。旧调用 `usage.known:false`，无图片/原始候选，未对账，也没有把本次新图冒充原请求的恢复结果。63 秒直连成功支持中间代理 60 秒截断这一判断，但具体线上配置仍需认证日志确认。

## 检查与制品

类型检查、扩展/画布 renderer/Web 生产构建、正式 npm 来源校验及 26 项 MCP/重试/范围检查通过。两轮全量各有 3334 通过、1 个不同的超时，其余 10 项按原配置跳过；下载用例单跑 6.42 秒、大图用例单跑 19.44 秒通过。未宣称有单轮全量全绿结果。

可复用脚本：`scripts/qa-ark-plan-image.mts`（显式允许、stdin 凭据、最多一次真实图片请求）与 `scripts/qa-ark-plan-image-saved.mts`（仅核对已有回执及存储，不启动应用或生图）。工作区的浏览器扩展并行改动保留，本修复使用独立工作树。原始日志、JSON、数据库与图片位于该工作树忽略目录 `artifacts/verification/ark-plan-image/`；此前原任务只读证据仍在主工作区 `artifacts/verification/ui-image-recovery-2026-10-23/`。生产模型配置和生产文档未修改。

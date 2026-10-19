# MCP 验收记录（2026-10-20）

全部操作使用隔离 SQLite 数据库、文件目录和合成账号，没有编辑用户文档。测试站是正常 HTTP Doca 服务；没有为原生文档工具配置 Doca 大模型。MCP 使用正式 TypeScript SDK 和已安装的 Codex CLI 实际连接，不以接口注入代替客户端验收。

| 验收项 | 结果与证据 |
| --- | --- |
| Codex 真实连接、发现工具与读取 SKILL | [codex.json](codex.json)，客户端版本和完成的 MCP 调用次数见记录 |
| 写报告、创建可编辑画板、PPT 和表格 | Codex 保存后读取；独立 SDK 再次读回、核对格式和归属。画板调用 `canvas_view` 查看实际图像 |
| Excel 文件 | [codex-mcp-metrics.xlsx](codex-mcp-metrics.xlsx)，下载后核对 ZIP 结构，再用正式 XLSX 解码器验证单元格数据 |
| 上传、文件夹与下载 | [http-client.json](http-client.json)：420,000 字节分块传输；本机、上传内容与下载内容 SHA-256 一致。Codex 也完成真实本机文件上传和下载 |
| 管理员代用户写入 | 公司 token 显式传目标 `userId`；独立检查报告所有者为目标用户，不能借用 token 创建者的私有文档权限 |
| 个人/管理员设置 | [browser.json](browser.json)：创建、编辑授权、复制 AI 安装指令、刷新读回、保存失败保留草稿、token 不写入持久 UI；[连续三次完整脚本运行](browser-runs.json)通过，每次包含三轮创建/编辑操作 |
| Switch 与页面遮挡 | 个人总开关和服务开关使用 Switch；总开关关闭/开启后刷新验证。桌面、700 CSS px 窄屏及 200% 等效布局（720 CSS px、2 倍像素密度）检查侧栏与内容不相交、无水平溢出 |
| 自动化回归 | [tests.json](tests.json)：3033 通过、10 跳过、0 失败；[最终相关回归](final-targeted-tests.json) 85 项通过（含 MCP 专项 12 项）。PostgreSQL [17](postgres17-tests.json) / [18](postgres18-tests.json) 各 14 项通过 |
| 实际已发行旧版升级 | 使用正式 `smartdoca/doca:0.2.4` 创建含已有用户、Markdown 正文和旧 MCP 记录的库，再由当前源码启动。SQLite、PostgreSQL 17/18 各保留 120 张原表的数据摘要，四张新表为空，代际不变 |
| 重复/并发启动与拒绝 | [三个数据库各三个独立进程并发重启](repeated-concurrent-upgrades.json)通过；专项测试覆盖未知结构和已安装表丢失时拒绝且无部分写入 |

升级明细：[SQLite](upgrade-sqlite.json)、[PostgreSQL 17](upgrade-postgres17.json)、[PostgreSQL 18](upgrade-postgres18.json)。表摘要用于核对原有行未变，不包含凭据原文。

页面证据：[个人服务与 Switch](personal-services.png)、[公司服务接入样例](admin-service-examples.png)、[窄屏](personal-narrow.png)、[200% 等效布局](personal-zoom-200.png)、[富文本](native-rich_text.png)、[画板](native-canvas.png)、[PPT](native-presentation.png)、[表格](native-spreadsheet.png)。截图由主执行者查看；这次局部 UI 修正未派独立设计评审，没有额外删减文案或增加动效。

可复现入口：`scripts/qa-mcp-server.mts` 创建隔离站；`qa-mcp-client.mts` 运行真实 HTTP SDK；`qa-mcp-codex.mjs` 运行真实 CLI；`qa-mcp-codex-verify.mts` 独立读回；`qa-mcp-ui.cjs` 运行浏览器检查。均要求 `DOCA_QA_ISOLATED=1`。私有 fixture 和完整客户端日志留在忽略目录 `.cache/`，不提交 token 或浏览器 cookie。

Codex 本机的 `approval_policy=never` 最初阻止了带破坏性声明的通用执行工具。验收进程使用官方支持的单工具 `approval_mode="approve"` 明确预授权这个隔离服务，再完成验收；未改变全局 Codex 配置，也未降低服务器的工具风险声明。页面提供同样的可选配置，普通接入样例不默认开启。

验证范围为源码和隔离站。付费外部 provider 没有为此次 MCP 验收额外调用；可选能力验证了配置后的目录与 schema、权限过滤和凭据不泄漏，实际执行继续复用已有助手管线。上下文、上传缓冲及视觉凭证属于单实例，重启后需重新打开上下文并检查已保存成果。详见 [MCP 使用说明](../../mcp.zh-CN.md)。

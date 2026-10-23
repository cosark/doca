# 本轮宿主浏览器验收

> 原始截图、JSON 和运行日志保存在本地忽略目录 `artifacts/verification/issue-tracker-2026-10-21/`；下文“本地产物”和“本地图片”的相对路径以该目录为基准，不随 Git 提交。原验收日期、结果和指纹保持原记录，仅整理附件位置。

2026-10-22 在最终已安装包组合的真实 Doca Web + Chrome 中复跑，来自当前工作树，使用合成账户、合成文档和临时文件存储。没有编辑用户问题表或其他用户数据。脚本是 `scripts/qa-issue-tracker-2026-10-21.mts`；它不重建公共 Web 目录，Vite 使用独立 cache、专用端口并关闭 HMR。

本轮包版本：Canvas 0.5.10、Sheet 0.2.7、Slate 0.4.24、Markdown 0.4.4、Slides 0.3.0-alpha.4。三份机器收据均记录这些实际安装版本；检查只覆盖下列指定场景，不替代其他Canvas原生功能的验收。

| 原表行 | 本轮实测结果 |
| --- | --- |
| 21 | 五种无 emoji 文档的浏览器 favicon 经 DOMParser 解析后与对应格式源 SVG 完全一致，逐个刷新仍保持。预览/加载未修改文档内容。 |
| 19 | 真实上传一张绑定到文档的合成图片，写入合成搜索描述；公开快捷键打开搜索后点击文件结果行和资源位置按钮，两次都关闭搜索并显露当前文档（same-hash）；文档 seq 不变。 |
| 3、16 | 1200×620 视口，选择 A30 后输入 `@`。候选菜单 bottom=547.5，真实可见单元格编辑器 top=553.5，完整分离6px且在视口内。ArrowUp 不收起，Enter 插入，真实宿主 ACK 后刷新回读包含原生 atomic mention。截图已实际查看。 |
| 7 | 从真实插件管理 UI 上传两个 ZIP，确认安装。每个合成插件仅注入公开 `storage.sql.v1` 和 `http.v1`，不含宿主源码路径，也没有自己的数据库连接配置。重启该隔离 Doca 实例后，两个插件使用相同表名、相同记录 ID，公开插件端点分别读到各自数据；SQLite、PG17、PG18 都通过。 |
| 9 | 上述相同网站安装、重启、命名空间及记录保留检查在专用 PostgreSQL17/18 服务器通过，原有用户数据库和其他Docker容器未使用。每轮核心 schema、插件业务库及角色由现有 `tests/database.ts` 隔离创建并清理。 |

机器结果和截图：

- SQLite（本地产物：`host-sqlite/browser.json`）、@菜单（本地产物：`host-sqlite/row16-sheet-mention-bottom.png`）、搜索目标（本地产物：`host-sqlite/row19-search-target.png`）、已安装插件（本地产物：`host-sqlite/row7-9-installed-plugins.png`）。
- PostgreSQL17（本地产物：`host-pg17/browser.json`）、已安装插件（本地产物：`host-pg17/row7-9-installed-plugins.png`）。
- PostgreSQL18（本地产物：`host-pg18/browser.json`）、已安装插件（本地产物：`host-pg18/row7-9-installed-plugins.png`）。

三轮浏览器 `pageerror` 均为零。既有 Vite 配置加载提示、Ant Design `autoFocusButton` 弃用提示仍存在；关闭/重启隔离后端时 Vite 偶尔记录 socket reset，此为测试生命周期关闭，不是页面异常。

## 复现

```sh
DOCA_QA_OUTPUT=.local/tracker-host-final node --import tsx scripts/qa-issue-tracker-2026-10-21.mts
```

PG 检查先启动全新专用服务器；**不要**将 `DOCA_TEST_POSTGRES` 指向业务库。设置该变量并加 `DOCA_QA_STAGES=plugins`，同时给独立 `DOCA_QA_PORT` 和输出目录，脚本沿用现有隔离 schema/业务库机制。没有 PostgreSQL 配置时仅把插件结果计入行7，不会把行9误报通过。

上述检查只覆盖列出的6个原表行，不表示59项全部完成，不表示生产 `doca.heyphp.com` 已部署当前源码，也不涉及付费模型、任意站点网络或原生品牌浏览器侧栏。

# 历史预览请求与图库隔离验收

> 原始截图、JSON 和运行日志保存在本地忽略目录 `artifacts/verification/issue-tracker-2026-10-21/`；下文“本地产物”和“本地图片”的相对路径以该目录为基准，不随 Git 提交。原验收日期、结果和指纹保持原记录，仅整理附件位置。

2026-10-22，真实 Chrome + 本地完整 Doca 网站，临时存储、内存 SQLite 和隔离合成账号/文档；Canvas 安装版本为 0.5.10。没有操作用户文档或数据库。

`DocumentRecords` 原先把每次历史查看响应直接写入预览，A 慢 B 快时迟到的 A 会覆盖 B。现在每次查看取消前一次请求，只接受当前请求的结果；关闭预览、关闭历史面板、切换面板和卸载也会取消待处理请求。预览子树按既有 `preview.id` 隔离，不同快照会销毁旧图库；同一快照保持当前图库状态。仅改变 UI 请求生命周期，没有修改历史 API、格式、存储、模型或兼容规则。

运行：

```sh
node --import tsx scripts/qa-history-preview-race-2026-10-22.mts
```

最终 **7/7 通过**，详见 results.json（本地产物：`history-preview-browser/results.json`）：

- 真正点击“查看”A 后点击 B，A 的真实授权响应被延迟；B 图库打开后释放 A，仍保持 B。请求记录包含服务端 200 和浏览器实际取消。
- 不同 Markdown 快照销毁前一个图库，新快照从其第一张图开始；同一快照重新查询保持图库 DOM 和拖动位置。
- 历史面板关闭后、关闭再重开后、离开文档卸载后，释放迟到响应均不重新打开预览。
- Canvas 两图快照切回原一图快照，旧图库关闭，新图库只含 `canvas-A.png`；通过实际主菜单“适合画布”和原生图片点击进入。
- Markdown 与 Canvas 的内容序号都保持为 2，验收交互产生 0 次协作内容更新，页面错误与 `console.error` 均为 0。

跨快照和同快照图库状态隔离两个压力场景，在图库已经打开时通过真实页面现有“查看”按钮的 DOM 激活调用公开 UI 处理器；没有调用编辑器私有句柄或修改文档/React 状态。A 慢 B 快、关闭与导航场景均使用正常鼠标操作。

截图：B 保持显示（本地产物：`history-preview-browser/latest-wins-B-gallery.png`）、Markdown 快照 A 重置（本地产物：`history-preview-browser/snapshot-A-gallery-reset.png`）、Canvas 原一图快照（本地产物：`history-preview-browser/canvas-snapshot-gallery-reset.png`）。修改文件的定向 TypeScript 检查及 `git diff --check` 通过。

此记录只覆盖宿主历史预览生命周期，不替代 Canvas 0.5.11 候选安装后的完整 16 阶段验收。

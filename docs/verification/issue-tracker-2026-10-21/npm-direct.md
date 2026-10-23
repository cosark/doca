# 编辑器正式 npm 接入收尾（2026-10-23）

本次继续核对“整理并修复 Doca 问题”的剩余项。运行日志、归档、截图和 JSON 收据保存在忽略目录 `artifacts/verification/npm-direct-2026-10-23/`。旧失败记录保持原结果；以下结论只对应列出的包和构建。

## Sheet 0.2.10

Doca 原先仍引用已被子包否决的第一份 `7ff06a…` 本地候选。现已改为精确 npm 依赖 `@smartdoca/sheet: 0.2.10`，锁文件使用 registry integrity，不再依赖 `.local/` 归档。正式包对应 [PR14](https://github.com/smartdoca/sheet/pull/14)、[GitHub Release](https://github.com/smartdoca/sheet/releases/tag/v0.2.10) 和 [npm](https://www.npmjs.com/package/@smartdoca/sheet/v/0.2.10)，源码提交为 `0fbc756b0127dc0d5996caa8d84f5d0c3655b7bf`。

安装的全部 63 个文件与正式归档逐字节一致；归档 SHA256 为 `42fe7041a4a933fdd89c76b62ebdf16b4ca4bea13585edfe5fdd924648908c79`，integrity 为 `sha512-0eoCPIGYt1q6aY0pVNSRj2Onv0P6BzWRhFGLFY8W0aVI+46paooJd9mP+jyDZmFLLDr+OOppXZF29gFmpc4ShA==`。model/Yjs/XLSX 的六个 ESM/CJS 入口与 0.2.7 相同，没有文档格式转换、baseline/epoch 重建或宿主兼容适配。

在正式 Canvas 0.5.14、Sheet 0.2.10、Slate 0.4.24（原 DOCX 补丁）、Markdown 0.4.4、Slides 0.3.0-alpha.4 组合及编译 Web 上完成：

- 原生网站两轮，各 8 组：超链接四种取消零写入、确认与撤销重做/重开，标题 Enter、流程图标签全选、空昵称光标、评论控件、表格尺寸和两账号共享筛选。
- 每轮 8 文档、14 客户端静置 60 秒，正文零更新，页面异常 0，运行前后完整包和构建指纹一致。
- Sheet 图库串行四轮，各 5 组：同格第二张图片、编辑草稿预览与取消、继续输入并显式提交、跨工作表/只读/历史和回收站；每轮包含待处理悬停后的键盘关闭，页面异常 0，四轮使用同一完整运行指纹。
- 类型检查、Web/renderer/扩展构建通过；全量 319 个测试文件、3331 项通过，3 个文件及 10 项跳过，0 失败。

精确收据：`sheet-official-audit.json`、`sheet-acceptance.json`、`native-1/results.json`、`native-2/results.json`、`gallery-2/results.json` 至 `gallery-5/results.json`。构建 index SHA256 为 `a7be047c561f3f4f2c3f4417dc37ba784853d07ae8a222b2581d20ee1c75fcfc`。

首轮图库与另一组原生浏览器操作并行时未打开预览，页面异常为 0；`gallery-1` 保留失败。后续四个完整串行轮次通过。全局焦点竞争只是当前推测，未当作已证明的产品根因。

## 发布来源检查

`scripts/verify-editor-package-sources.mjs` 在部署打包、GitHub Release 和镜像发布流程中检查五种编辑器：必须使用精确 npm 版本且没有生效的本地编辑器补丁。过时编辑器补丁已移除，Git 历史和本地副本可用于恢复。手工反例确认本地 file/link/workspace 依赖、版本范围和 active Slate patch 会阻止发布。

## Slate 0.4.25

正式 npm 0.4.25 已接入，全部 192 个安装文件与公开归档逐字节一致。源码提交 `f811964af62b59206220f4920a4fce133c7e46e7`，归档 SHA256 `7d2fcaea3dcb1bf21fb53d7bedcd5a337006c91e05037b04d4affee8bdcfa7fa`，integrity `sha512-10YyVnsZ2HnvpX63j1+R51jbdfT5ro1Vz3V5S+ukuE/k3r6zik9bUk57vM9r7zpMG34+SLbrUy5qRCaE5OOhHw==`。公开 exports、类型及 codec/Yjs/headless 保持原边界。Doca 已解除 DOCX patch 绑定；过时编辑器补丁文件在保留本地副本后移除，原源码可通过 Git 历史恢复。

安装后的真实 DOCX/PDF 两个测试文件、6 项通过。隔离网站使用实际新包导出并重导入：富文本 3 页、Markdown 1 页，文字、图片、数学公式和控件检查通过，源 Y.Doc 零写、页面异常 0；数学与图表截图已复看。收据为 `slate-official-audit.json`、`slate-pdf-tests.log`、`slate-pdf-browser.log` 和 `slate-pdf-browser/`。发布来源检查已由拒绝 Slate patch 转为通过。

## Sheet 0.2.11 与新增缩放需求

正式 [Sheet 0.2.11](https://github.com/smartdoca/sheet/releases/tag/v0.2.11) 已接入，源码 `01bb1eddc83c35b13c49ea7457e6e18640823205`，SHA256 `41dd45288b604efe8d97bd0cd4511f1d8c366af288b59ac3853221fd954f5d59`，73 个安装文件与公开 npm 归档一致。新增实际 `viewPreferences` / `onViewPreferencesChange` 及纯校验器；model/Yjs 四个入口相比 0.2.10 仅改变获批默认尺寸，XLSX 两个入口相同，依赖及已有导出路径不变。

按用户批准，默认缩放仍为 100%，默认行高/列宽为 21.78/87.12；未记录默认尺寸的历史附加/恢复表也采用新默认，已保存尺寸及协作字节保留。浏览器仅按网站、账号、文档保存用户明确调整的缩放；坏记录原样保留、无法写入时本次视图仍可调整。针对性 9 项通过。编译网站 7 组通过实际滑块、加减、刷新、同浏览器同伴、文档与账号隔离、只读、未知/坏记录、拒写及至少 60 秒零正文写入；页面错误和模型请求均为 0。首轮脚本只等 footer，过早拖拽尚在加载的原生 UI；改为等待原生 ready 后通过，原失败及中断记录保留。

同一最终包/锁文件/Web 上，原生 8 组两独立轮、图库 5 组四串行轮均通过，含延迟悬停及键盘关闭，页面错误 0。最终组合为 Canvas 0.5.14、Sheet 0.2.11、Slate 0.4.25、Markdown 0.4.4、Slides 0.3.0-alpha.4；Web index SHA256 `4e9e471f3033138ef4114d0462681e8982f1e4411edbdbca02c7bc0fe74dd376`。全量 320 个文件、3335 项通过，3 文件/10 项跳过。资源竞争下的并行渲染超时记录保留；单独渲染套件及限制两 worker 的完整重跑通过，没有放宽断言或产品限制。

新增收据在 `artifacts/verification/sheet-zoom-2026-10-23/` 与 `artifacts/verification/npm-direct-2026-10-23/final/`。镜像清理、分层与增量下载见[专门记录](image-size.md)。完整镜像双架构功能验收和 GitHub/DockerHub 发布已完成，见[最终发布回执](release.md)。

Mastra memory 是仍然需要的第三方 SDK 补丁，已核对其反射修复及当前 core 缺少的导出，不能仅删除保护；详见 [补丁说明](../../../patches/README.md)。Doca 0.2.8 已发布 GitHub/DockerHub；生产站点未升级。原 UI 图片请求的供应商未知用量和未返回图片仍是独立外部限制，禁止自动重试。

## 最终编译网站的其余验收

同一 Web index `4e9e471f3033138ef4114d0462681e8982f1e4411edbdbca02c7bc0fe74dd376` 上，Canvas 原生 17 阶段（含最小表格编辑/工具切换/撤销）和个人偏好 7 组通过，原生/偏好两套均无页面异常且前后完整运行指纹一致。偏好静置至少 60 秒零内容写入。检查脚本通过 Playwright 的隔离检查模块访问实际编译 Web 已加载的公开引擎实例，未另载引擎或改动应用产物。

AI 修复后精确场景在新合成文档只读复开：保留全部 41 个 ID、手机原生 metadata 和其余场景字段；纯打开/刷新、实际 Hand/fit/Select/再刷新零正文写入、零内容 frames、零模型请求。原数据库从未打开，源 JSON 哈希及完整运行指纹前后相同。已人工查看手机、Web 和关系图三张实际浏览器截图：手机外框/刘海/侧键/底条、标题/卡片/按钮，Web 侧栏和卡片，三表及两条带标签关系线可见。人工检查哈希收据位于 `final/ai-native-readonly/manual-pixel-review.json`。此前真实模型生成/续写/导航失败各自保留，此次只读检查不改写原结果。

五格式评论全部通过，含实际键盘、上传/发送状态、草稿与分页；嵌入式 390px 手机视图检查通过，至少 61 秒零正文更新、页面异常 0。实际打包 MV3 的浏览器与服务端两份报告均通过，包含图片原字节、登录/退出/撤权、账号隔离、待发送恢复和速记；付费模型请求 0、用户数据使用 false。扩展 ZIP SHA256 `8238cdc375f5040ca0ab2877c9bee26afa540c1a110c884f9c1f6430cf702db3`，打包资源 SHA256 `a9123b3fa2341c2addd5a62b3c23f2fdbf330907ca7ea4d9120f3c070918f748`。

精确收据分别位于 `final/canvas-native-2/`、`final/canvas-preferences/`、`final/ai-native-readonly/`、`final/comments/` 和 `final/extension/`。源文档和项目/全局技能引用已经同步。GitHub/DockerHub 已发布，双架构实际大小见[最终回执](release.md)；生产站点没有由本轮升级。


远端首轮 PostgreSQL 检查暴露干净检出未构建扩展资源：扩展下载测试因缺少 `generated/` 返回 500，其余数据库检查通过。测试现先构建实际扩展，并校验 ZIP 含助手 JS/CSS；不新增运行时回退。SQLite 14 项通过；从缺少 generated 目录开始，PostgreSQL 17/18 各 14 项独立通过，测试模式重建资源稳定；另以 `NODE_ENV=production` 重建后，100 个资源与已验收 MV3 及两个原生镜像逐字节一致。远端最终 PostgreSQL 17/18 各 289 项通过，原失败不删除。

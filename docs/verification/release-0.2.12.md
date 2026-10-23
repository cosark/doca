# Doca 0.2.12 发布验收

2026-10-23，本次修复浏览器助手导航后抓取脚本尚未响应导致的 `clipper_page_unsupported`。宿主版本为 0.2.12，浏览器扩展版本为 0.2.1。[GitHub v0.2.12](https://github.com/smartdoca/doca/releases/tag/v0.2.12) 和 [Docker Hub](https://hub.docker.com/r/smartdoca/doca/tags) 已发布；正式 tag 指向 `017e7dba75d89d695f4191fd07663a9cc83eee25`，[PR87](https://github.com/smartdoca/doca/pull/87) 已合并。后续验收文档不移动正式 tag。

## 修复与定向验证

抓取只访问当前 HTTP(S) 标签页顶层框架。没有接收器时注入扩展自带的 `capture.js`、`select.js`、`content.js`，立即执行并重试一次；明确的选区错误不触发补载，受限页面和拒绝注入仍失败。内容脚本防止重复注册工具栏及消息监听器。

141 项相关测试通过，覆盖脚本缺失、空响应、注入拒绝、重试次数、重复注入、当前标签页/页内路由、助手传输及服务器打包；下载包断言包含 `scripting` 权限。修复阶段 TypeScript 和扩展构建通过。

正式版本全量回归使用 `pnpm exec vitest run --maxWorkers 4`，322 个文件通过、3 个按配置跳过；3340 项测试通过、11 项按配置跳过，无失败，耗时 291.02 秒。默认并发初次运行曾出现 8 项超时/状态等待失败及 2 个清理阶段未处理拒绝；原日志保留，未调整测试超时或应用代码，降低并发后完整重跑通过。生产 Web/扩展/Canvas renderer 构建、npm 编辑器来源、双语文档及部署打包通过；[主分支 PostgreSQL 17/18 矩阵](https://github.com/smartdoca/doca/actions/runs/39970377868) 全部通过。

复用脚本 `node tests/qa-browser-extension-navigation.mjs` 在隔离 Chromium MV3、合成站点及独立浏览器存储中验证：先在第一页发送，再导航到阻塞解析、尚无接收器的第二页；在 `document_idle` 前补载并发送，随后页内路由发送、切换另一标签页抓取。三条消息使用同一会话、每条提交一次，网页没有重载。旧版 background 在同一场景返回与用户截图相同的 `clipper_page_unsupported`；修复版通过。该用例验证实际扩展消息传输和抓取脚本，不调用真实模型，不代替完整对话界面验收。

## 双架构镜像与公开校验

[原生镜像流水线 39970730474](https://github.com/smartdoca/doca/actions/runs/39970730474) 全部通过，构建提交与正式 tag 一致。amd64、arm64 均验证 UID1000、原图字节、登录/退出/撤权、Chromium namespace/seccomp 沙箱 PDF、Canvas 真实像素及 DOCX/XLSX→PDF。每个架构的 569 个运行文件、483 个 Web 文件及 9 个编辑器入口/清单与源码构建一致，包含修复后的扩展脚本和 manifest。渲染检查保留只读根目录、无网络及临时 home；供应商调用为零。

流水线完成后，另以只读 Docker Registry HTTP API 验证公开索引和两个子 manifest 的原始字节 SHA256、Docker-Content-Digest 及验收摘要。`0.2.12` 与 `latest` 均指向：

`sha256:2d7abe606a0e72f76b69fd58445001968364d1b0828ff029d8e8f7408b291cab`

| 架构 | manifest 摘要 | 完整压缩层字节 | 保留 0.2.11 时新增唯一层字节 |
| --- | --- | ---: | ---: |
| amd64 | `sha256:290d70aa4db4c5aa6976a427fb6204b0e646d795fd028e8e434f7a65aead8467` | 707,927,022 | 3,166,093 |
| arm64 | `sha256:5a111f52902b884d742a6eed9b384e22853496f5d334c90d32398f504ec5d69f` | 704,728,643 | 3,166,084 |

增量要求同架构的 0.2.11 旧层仍在本机，按缺少的唯一压缩 blob 求和，不包含 manifest/config 或传输头部；首次拉取需要完整镜像。未删减 Chromium、Office、字体或编辑器功能。

## GitHub 附件

[正式 Release 流水线 39970722380](https://github.com/smartdoca/doca/actions/runs/39970722380) 通过。三个公开附件均实际下载，大小与 SHA256 匹配 GitHub 元数据；Web 的 478 个文件与本地正式构建逐字节相同，部署包 10 个允许文件与本地同版本包逐字节相同，同名校验文件正确。本地打包使用 COPYFILE_DISABLE=1。

| 附件 | 字节 | SHA256 |
| --- | ---: | --- |
| doca-deploy-v0.2.12.tar.gz | 18,419 | `83305986f4080a9d83f66acb39efe535f62c575a673b165edb612f515e7c0268` |
| doca-deploy-v0.2.12.tar.gz.sha256 | 93 | `72f26f16174c9a87b9f7ca1d9d1c8ea9cee4f2489b6a17718c273c4f35419d91` |
| doca-web-assets-v0.2.12.tar.gz | 17,162,031 | `9d5b18bbfeeea745eb63bdbe998552cdac53a6aca97a1a69ba3da61240399b16` |

本次临时添加的 GitHub Docker Hub 发布 secrets 已删除并确认不存在，没有记录凭据内容。其他凭据保持原状。原始报告、日志、归档、测试浏览器存储及截图均位于忽略目录 `artifacts/verification/release-0.2.12/` 和 `artifacts/verification/browser-extension-navigation/`。

## 保留与范围

本次没有数据库结构或数据格式变化，不转换、删除或回填已有数据，不发布 npm SDK。生产站点尚未部署。用户需要下载并重新加载扩展 0.2.1 才能使用本次修复。

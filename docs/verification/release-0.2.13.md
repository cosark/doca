# Doca 0.2.13 发布验收

2026-10-24 完成发布验收。Doca **0.2.13**、浏览器扩展 **0.2.2** 已发布到 [GitHub](https://github.com/smartdoca/doca/releases/tag/v0.2.13) 和 [Docker Hub](https://hub.docker.com/r/smartdoca/doca/tags)。正式 tag 固定指向 `b5e893b8af20385874a313215d129de5e1584854`，[PR89](https://github.com/smartdoca/doca/pull/89) 已合并；后续回执文档不移动 tag。

## 功能及回归

右侧常驻四个收录、选区、助手和设置入口，支持上下拖动及刷新恢复；收录前在气泡确认规则，选中文字不再额外出现图标。共享 AI 对话及待发送列表按 ID 分配展示，原 IndexedDB 恢复副本及接收核对不变。

图片处理遵守用户明确批准的新收录规则：超大静态图压缩，保留原编码、透明度和 EXIF 显示方向，动画不转静态，已保存及已上传图片不重新处理。详细规则、边界及像素结果见[功能验收](browser-extension-dock-2026-10-23.md)。

- 定向 206 项测试通过；完整 `pnpm exec vitest run --maxWorkers 4` 为 324 个文件通过、3 个按配置跳过，3352 项通过、11 项按配置跳过，无失败，耗时 242.94 秒。
- TypeScript、生产 Web/扩展/Canvas 构建、编辑器 npm 来源、88 页双语文档及部署打包通过。
- 真实 Chromium MV3 连续三轮通过；生产扩展 0.2.2 构建后另验一轮，每轮 11 次收录请求、2 次消息提交，覆盖透明图、EXIF、拖动、选区、失败重试、待发送去重及刷新恢复。390px 与原生 200% 缩放通过，独立视觉评审无必须返工项。未使用用户文档或付费模型。
- 页面切换恢复回归通过：在 `document_idle` 前恢复脚本，导航、SPA 及切换标签无需刷新。同一会话三次消息提交无重复。
- [PR PostgreSQL 17/18](https://github.com/smartdoca/doca/actions/runs/39982020638) 与[正式主分支矩阵](https://github.com/smartdoca/doca/actions/runs/39982714775) 全部通过。

## 镜像与公开索引

[原生 amd64/arm64 流水线](https://github.com/smartdoca/doca/actions/runs/39982840615) 全部通过。两种架构均验证 UID1000、登录/退出/撤权、小图原始字节保全、沙箱 PDF、Canvas 真实像素和 DOCX/XLSX 转 PDF。每架构 571 个运行文件、483 个 Web 文件及 9 个编辑器入口/清单与正式源码构建一致；本地另核对新扩展的 7 个关键文件哈希，包含图片处理模块、manifest 和正式助手 bundle。供应商调用为零。

发布后以只读 Docker Registry HTTP API 重新读取公开索引及子 manifest，校验原始字节 SHA256、Docker-Content-Digest、子镜像和 config 摘要。`0.2.13` 与 `latest` 均为：

`sha256:70ff5f9459db06583f5eb478a830b186014f965d17d70f9f76ac22d7845f5686`

| 架构 | manifest 摘要 | 完整压缩层字节 | 保留 0.2.12 时新增唯一层字节 |
| --- | --- | ---: | ---: |
| amd64 | `sha256:7364ba158a6ddeb459131a28ff8745792bfa3169905db8af2775cfbc30370bb8` | 707,934,232 | 12,482,834 |
| arm64 | `sha256:7ed980cc010afee85967dfd925c9643e27633c42c0f4b2c42ec68bd6760b3f78` | 704,735,857 | 12,482,794 |

增量以前一版本同架构镜像层仍在本机为前提，仅合计缺少的唯一压缩 blob，不含 manifest/config 和传输头部。首次拉取需要完整镜像。未删减 Chromium、Office、字体或编辑器功能。

## GitHub 附件

[正式 Release 流水线](https://github.com/smartdoca/doca/actions/runs/39982782602) 成功。三个公开附件均已实际下载并与 GitHub 大小及 SHA256 元数据匹配；Web 的 478 个文件及部署包的 10 个允许文件与本地正式构建逐字节一致，校验文件正确。本地部署打包使用 `COPYFILE_DISABLE=1`。

| 附件 | 字节 | SHA256 |
| --- | ---: | --- |
| doca-deploy-v0.2.13.tar.gz | 18,420 | `3e5020a95087ae6b03c188e5371510fb7a916195750e2e832bfca625822a3a21` |
| doca-deploy-v0.2.13.tar.gz.sha256 | 93 | `df71e8fbf2a559b58c17c3efe916ed6a360fa2fe5e0d6e24077fa94a3b95c8e3` |
| doca-web-assets-v0.2.13.tar.gz | 17,163,262 | `3612b2f5b2b2509784e6a93fe9b877281de390b301b79fcddf2126b60e5bb114` |

临时 GitHub Docker Hub 发布 secrets 已删除并核对不存在，未记录凭据内容。原始执行日志、下载、JSON、浏览器存储及截图均位于忽略目录 `artifacts/verification/release-0.2.13/` 和 `artifacts/verification/browser-extension-dock/`。

## 更新范围

本次不改变数据库结构、队列格式或编辑器 SDK，不迁移、删除或回填已有数据。保留原数据库、文件及浏览器存储，回退遵守既有队列停用约定。

更新 Doca 镜像后，从「浏览器助手」设置重新下载并加载扩展 **0.2.2**，刷新已打开网页显示新工具条。已有旧扩展不会仅随服务端更新而改变。此回执确认 GitHub/Docker Hub 制品发布，未部署用户的生产站点。

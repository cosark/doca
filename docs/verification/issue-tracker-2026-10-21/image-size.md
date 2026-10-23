# 镜像体积与增量下载核验（2026-10-23）

本轮按用户追加要求检查完整镜像体积及后续更新下载量。原始层清单、OCI 归档、JSON、执行日志均在忽略目录 `artifacts/verification/image-size-2026-10-23/`，不随文档提交。本记录的 0.2.7 隔离实验不是 0.2.8 正式镜像验收。

## 体积口径

本地 `docker image ls --tree smartdoca/doca:0.2.7` 显示双架构合计约 5.72GB 磁盘占用；amd64 约 2.85GB、arm64 约 2.87GB。压缩内容分别约 722MB、719MB。单台服务器只拉取对应架构，Docker Desktop 的本地磁盘统计还包含解压内容。

在一次性 arm64 容器中只读检查，Node 依赖约 590MB、Chromium 约 367MB、LibreOffice 约 280MB、字体约 96MB（十进制）。Chromium 用于无窗口 PDF 导出、画布截图和 AI 视觉检查，Office 负责 Office 渲染；本次保留这些功能和中文字体。

## 清理与运行验证

新增构建清理仅处理依赖声明、TypeScript 构建记录、SQLite 编译输入和非当前平台预编译文件。先通过公开 SQLite API 在内存库执行查询，识别实际已加载绑定；未能证明当前绑定可用时停止清理。运行 JS/TS、当前原生文件、清单、许可证保留。

旧正式镜像的隔离实验移除 13,231 个文件，去重内容共 82,122,771 字节。26,633 个运行代码及许可证文件 SHA256 保持一致；新进程的 SQLite 原生读写、tsx、五类编辑器服务端入口、Mastra、Sharp 和 Playwright 导入通过。收据为 `cleanup-verification-2.json`。失败的验证脚本尝试及日志保留，后续镜像仍须通过完整运行验收。

## 分层与复用验证

通用依赖、Canvas、Markdown、Sheet、Slate、Slides、安装记录拆为七个 `COPY --link` 层。合并后的 32,465 个文件/链接与原树的字节、权限和链接目标完全相同；原生 SQLite 和运行入口的新进程检查通过。只给隔离 Sheet 包加入一个无运行用途的测试文件时，仅 Sheet bucket 的摘要变化。收据为 `split-verification-2.json`。

另外用真实旧镜像依赖树构建两份 OCI 实验制品。第一份七层压缩内容共 103,256,699 字节；第二份只增加上述 Sheet 测试文件，六层摘要相同，新增层为 334,111 字节，manifest/config 合计 3,637 字节。每个 OCI blob 均校验 SHA256。这证明分层边界及 `COPY --link` 的实际复用，不能据此声称任何真实版本升级都只下载 334KB。收据为 `incremental-download-verification.json`。

CI 使用独立、按架构区分的仓库构建缓存，避免全新 runner 每次重建相同系统/渲染器层。首次采用新布局仍需下载新层；后续实际增量取决于基础镜像、系统依赖、通用依赖、编辑器和 Web 的变化。正式镜像验收另外记录每架构压缩层字节、摘要和功能结果；GitHub/DockerHub 的实际发布收据优先于本隔离实验。

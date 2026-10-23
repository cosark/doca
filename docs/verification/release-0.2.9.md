# Doca 0.2.9 发布验收

2026-10-23 已发布 [GitHub v0.2.9](https://github.com/smartdoca/doca/releases/tag/v0.2.9) 和 [DockerHub smartdoca/doca](https://hub.docker.com/r/smartdoca/doca/tags)。正式 tag 与镜像构建均为提交 `655e7ecf71274417d2cf5f352f9151612c702859`；后续文档回执不移动 tag。

## 双架构功能与公开索引

原生 amd64/arm64 [镜像流水线 39917603413](https://github.com/smartdoca/doca/actions/runs/39917603413) 全部通过。两个架构均验证登录/退出/撤权、原图字节、UID 1000、启用 Chromium namespace/seccomp 沙箱的 PDF、448×208 画布真实红蓝像素及 DOCX/XLSX→PDF。只读根目录、无网络及临时 home 保持启用；外部模型调用和用户数据使用均为零。

镜像各自的 568 个运行文件、483 个 Web 文件和 9 个编辑器入口/清单与本地冻结构建逐项一致。Chromium、Office、中文字体及五种正式 npm 编辑器全部保留。此次仅改变镜像打包与根版本清单；未引入 API、偏好、数据库或队列格式变更，生产站点未部署。

`0.2.9` 与 `latest` 经再次独立只读检查，均指向：

`sha256:52810ebaf40ca998f4a26eb6f00e6dd88a2ef567c543874387d5405a3f36b0c6`

| 架构 | manifest 摘要 | 完整压缩层字节 | 保留 0.2.8 时新增层字节 |
| --- | --- | ---: | ---: |
| amd64 | `sha256:de3f0e2755b256b4442c0631e80c7bcc09719ef3cf4c662472d9beb0047fddac` | 707,921,380 | 19,957,274 |
| arm64 | `sha256:8e4affac7d71c5dc84223f0416aa1bcb5f897b9b5fcda19330484b47d219c7d9` | 704,722,946 | 19,956,943 |

新增下载为旧层仍在本机时缺少的唯一层 blob 总和，不包括 manifest/config 和传输头部。每个架构复用 17 个旧层；完整镜像 46 层。首次切换布局约下载 19.96 MB，后续改动大小取决于实际变化。隔离入口及真实 Vite CSS 重建实验见 [Web 层核验](image-web-layers-2026-10-23.md)。

## GitHub 附件

[Release 流水线 39918706288](https://github.com/smartdoca/doca/actions/runs/39918706288) 通过，三个附件均已下载并验证 GitHub SHA256/大小；Web 附件 478 个文件与冻结构建完全一致。部署包仅有 10 个允许文件，内容与从同一提交推导的 image-only 配置及初始化说明一致，SHA256 校验文件正确。首次本地部署包比对受 macOS AppleDouble 元数据影响，原输出保留；使用 `COPYFILE_DISABLE=1` 重建本地比较包后通过，公开 Linux 附件不含这些元数据。

| 附件 | 字节 | SHA256 |
| --- | ---: | --- |
| doca-web-assets-v0.2.9.tar.gz | 17,158,715 | `a74a2e9b16067ffe6c1645dc1ad3891cbdf1bce979ef321ca275b33a49c3841e` |
| doca-deploy-v0.2.9.tar.gz | 18,415 | `afcbd73e1e78b1ef3a1be724923892dd2d0b7a1234e6370698409c4804d890f5` |
| doca-deploy-v0.2.9.tar.gz.sha256 | 92 | `4756ee4911d408037c11b7ec30d565c7d76be2f480cf69bd20f2052d80b8f052` |

## 检查范围与保留项

- Web 分组验证覆盖全部文件字节/权限、生产 COPY 行和所有 OCI blob，真实 CSS 重建仅修改隔离源码副本。
- 编辑器 npm 来源检查、JavaScript 语法、文档链接/构建及部署打包通过；版本提交的 [PostgreSQL 17/18 检查](https://github.com/smartdoca/doca/actions/runs/39915507269) 各 289 项通过。应用源码与 0.2.8 已验收字节一致，本轮未冒称重新运行其 3335 项全量套件。
- 发布所用两项临时 GitHub DockerHub secret 已删除并确认不存在，未修改其他凭据。
- UI 生图 504 仍无返回图片且用量未知，原 call/operation 保留，不自动重试。任务恢复与网关排查另行继续，未包含在 0.2.9 中；必要 Mastra memory 补丁保留。

原始执行日志、JSON、OCI 制品和下载归档位于忽略目录 `artifacts/verification/release-0.2.9/` 与 `artifacts/verification/image-incremental-2026-10-23/`，本页仅提交审核摘要。

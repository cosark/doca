# Doca 0.2.8 发布回执

[GitHub Release](https://github.com/smartdoca/doca/releases/tag/v0.2.8) 的三个附件与 DockerHub `smartdoca/doca:0.2.8` / `latest` 均已核验。原生 [amd64/arm64 构建与发布](https://github.com/smartdoca/doca/actions/runs/39911273662) 全部通过；先前只读用户目录导致的 Crashpad 检查失败保留在[镜像记录](image-size.md)，未越过发布门槛。

## 镜像与下载口径

以下是公开 OCI manifest 中所有压缩层的字节合计，按单个架构比较；不含很小的 config/index，不是本地双架构磁盘占用。

| 架构 | 0.2.7 压缩层字节 | 0.2.8 压缩层字节 | 减少 |
| --- | ---: | ---: | ---: |
| amd64 | 724,223,431 | 707,896,441 | 16,326,990（2.25%） |
| arm64 | 720,968,812 | 704,698,316 | 16,270,496（2.26%） |

完整功能版约从 724/721 MB 降至 708/705 MB。Chromium、Office 和中文字体保留；后续下载优化主要来自公共依赖与五种编辑器独立分层、系统层缓存和按架构保存的构建缓存。服务器保留已有层时只下载变化层；首次切换布局、基础镜像或相关依赖变化仍会下载对应新层。隔离实验六层复用、一层 334KB 的结果仅证明分层边界，不是每个真实更新的固定承诺。

公共双架构 index：`sha256:c86d7fe0ff7d54d5db1c6c125041c8a31fdf0df0f75f4789d8c34bb8f18f690a`。发布检查及本地只读复核要求 `latest` 与 `0.2.8` 指向同一已接受 index，平台 manifest/config 均与原生验收镜像相同。

| 架构 | 平台 manifest |
| --- | --- |
| amd64 | `sha256:26f574628a8bede71e1240c72f30fb9bce0299496723f2124c12114a7a936d9c` |
| arm64 | `sha256:d0006277814d51c06cd488ea2af0c5f04252a1a366a7a339e83a20adb20247d1` |

两个原生镜像均以 UID 1000 验证：网站/扩展鉴权、退出和撤权、原图字节保留；断网、只读根目录与临时可写用户目录下的 namespace/PID/network/seccomp 沙箱、应用 PDF、画布红蓝像素及源场景不变、DOCX/XLSX 转 PDF。模型调用与用户数据均为 0。每架构 568 个运行源码/扩展/renderer 文件及 483 个 Web 文件与对照构建逐字节一致；本地恢复正式 production 构建后，也与已验收网站和 MV3 的全部对应字节相同。测试模式生成文件名差异另留审计，不改已发布运行产物。

## GitHub 附件

[GitHub 发布流程](https://github.com/smartdoca/doca/actions/runs/39909813823) 通过，三个下载附件的大小及 SHA256 与 GitHub 元数据相同；Web 归档的 478 个资源文件与最终网站验收构建一致。部署包另核对内置校验和与允许文件清单，没有环境凭证或数据库。

| 附件 | 字节 | SHA256 |
| --- | ---: | --- |
| `doca-deploy-v0.2.8.tar.gz` | 18,410 | `b3ee91d60b6f2671b6b10a318b7a9bd20687e3bdb4b419112739eda0a09e02e6` |
| `doca-deploy-v0.2.8.tar.gz.sha256` | 92 | `65ac1b53f43238058a17d55b0bda883d93c5a90165bd5547c2ad970c2979dbc1` |
| `doca-web-assets-v0.2.8.tar.gz` | 17,158,816 | `013a1f4b0e782f80e05c7bf2d87ba08e1a6e3f45ded7e40fe08fcc7e311cb3ea` |

## 源码、验证与保留边界

版本标签保持 `acfde4ad2a86387a610621f4c60958ecfc7037d4`。镜像构建 revision 为 `c40544532b914d323156ee3a661d8019a2344eae`，其与标签的差异仅为检查脚本及审查记录；全部 Docker 构建输入相同，标签未移动。发布凭证仅在本次流程临时使用，完成后已删除并核对不存在。

最终五种正式 npm、3335 项全量测试、类型/构建、两轮原生、四轮 Sheet 图库、缩放、Canvas 原生/偏好、评论、AI 修复场景只读复开和实际 MV3 的精确范围见 [npm-direct.md](npm-direct.md)。远端 PostgreSQL 17/18 各 289 项通过。旧模型、候选和检查失败保留各自原结果。

表格默认仍 100%，基础行高/列宽为 21.78/87.12，逐文档个人缩放缓存；已批准历史缺省尺寸和 IDB 队列升级/回退要求见[发布说明](../../releases/0.2.8.zh-CN.md)。保留全部存储和后续数据，升级前停止旧 sender。生产站点未由本轮部署。

唯一保留的外部结果限制是 UI 生图 HTTP504：未返回图片、用量未知、未对账；原数据和费用待核对提示保留，不自动重试。Mastra memory 仍保留必要的第三方反射补丁，不扩大未经批准的 SDK/存储升级。

原始 JSON、完整运行文件哈希、日志和下载归档位于忽略目录 `artifacts/verification/release-0.2.8/`，发布摘要经过审阅后记录于本页。

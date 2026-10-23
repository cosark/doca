# Doca 0.2.10 发布验收

2026-10-23 已发布 [GitHub v0.2.10](https://github.com/smartdoca/doca/releases/tag/v0.2.10) 和 [DockerHub smartdoca/doca](https://hub.docker.com/r/smartdoca/doca/tags)。正式 tag 与镜像构建均为提交 `33093ab5608ecd6a3330d781a3e88f4a6f183a04`；[修复 PR82](https://github.com/smartdoca/doca/pull/82) 已合并，后续文档回执不移动 tag。

## 双架构功能与公开索引

原生 amd64/arm64 [镜像流水线 39947781821](https://github.com/smartdoca/doca/actions/runs/39947781821) 全部通过。两个架构均验证登录/退出/撤权、原图字节、UID 1000、启用 Chromium namespace/seccomp 沙箱的 PDF、画布真实红蓝像素及 DOCX/XLSX→PDF。只读根目录、无网络及临时 home 保持启用；镜像验收未调用外部模型，也未使用用户数据。

每个镜像的 569 个运行文件、483 个 Web 文件和 9 个编辑器入口/清单与本地正式构建逐项一致。全量测试会生成扩展测试模式产物，最终字节对照前已重新构建正式扩展、renderer 和 Web。Chromium、Office、中文字体及五种正式 npm 编辑器保留；必要的 Mastra memory 补丁保留。

公开 `0.2.10` 和 `latest` 均验证为：

`sha256:872e724fb4b839df1a067fa743321792ebe4737e99d32a500b2f776e58d87034`

| 架构 | manifest 摘要 | 完整压缩层字节 | 保留 0.2.9 时新增层字节 |
| --- | --- | ---: | ---: |
| amd64 | `sha256:a9c474787f7211e204b5d3d07f009b7b8e03cc9062f758396a0255b95345e371` | 707,923,679 | 5,629,137 |
| arm64 | `sha256:c9e7fac6487fed0e0ade510f7c6c530164a5cfb203c308f16aafe87f1db0b547` | 704,725,225 | 5,629,132 |

每个架构复用 46 层中的 42 层，只有 4 个新增唯一层需要下载，约 5.63 MB。此数字要求相同架构的 0.2.9 旧层仍在本机，按缺少的唯一压缩 blob 求和，不包含 manifest/config 和传输头部；首次拉取仍需完整镜像层。未删除渲染能力来减少下载。

## GitHub 附件

[Release 流水线 39949622192](https://github.com/smartdoca/doca/actions/runs/39949622192) 通过。三个附件均已实际下载并核对 GitHub SHA256/大小、部署包校验文件；Web 附件 478 个文件与正式构建逐字节一致。部署包仅含 10 个允许文件，内容与相同提交生成的 image-only 配置及初始化说明一致。本地部署比较包使用 COPYFILE_DISABLE=1 排除 macOS 元数据。

| 附件 | 字节 | SHA256 |
| --- | ---: | --- |
| doca-deploy-v0.2.10.tar.gz | 18,419 | `a556a06a3738ecb8ef66dea278e0bd0115ebc76ba9ef9ae83ba84f6116307e1b` |
| doca-deploy-v0.2.10.tar.gz.sha256 | 93 | `74ba2d01a9c9290561d9eab35cae255afdf0e07a36defbfaa91419a5e126719c` |
| doca-web-assets-v0.2.10.tar.gz | 17,159,127 | `91e25b2ac1d1fbd979ac1702f3132b6b48b35e411fd48c8143ba8f208189ab7b` |

## 数据保留与验证范围

- 用户最终确认仅采用原生字段修改：PostgreSQL 同类型 varchar 扩宽、默认值和空值约束；SQLite 仅空值约束，默认值差异仍停止启动。不重建或替换业务表，不关闭外键，不直接修改系统 schema，不补造旧值，不自动降级。有 NULL、类型转换、长度缩小、主外键/唯一/CHECK、未知对象等差异先拒绝，整个事务无部分写入。详见[升级规范](../database-schema-evolution.zh-CN.md)。
- 用实际发布的 0.2.9 源码创建 SQLite、PG17/18 隔离库，131 张原表数据哈希完整保留；PG 目录只有 assets.purpose 长度 16→32，SQLite 完全不变。重复/并发启动、原生属性调整、SQLite 根页/行号、父子表记录及失败回滚均有回归。此处为发布源码创建的旧库，未冒称运行旧容器镜像。
- 最终全量 3343 项通过、11 项按配置跳过，无失败；321 个文件通过、3 个跳过。类型检查、正式 npm 来源、文档链接和生产构建通过。[最终发行头 PG17/18 矩阵](https://github.com/smartdoca/doca/actions/runs/39946934533) 全部通过。
- 一次独立合成火山 Plan 图片请求在 63.354 秒后 HTTP200，保存 2731×1536 原图及原始候选。用最终代码恢复已有回执/存储，供应商调用为零、字节一致。此前原网关 504 仍无返回图片且用量未知，原记录与数据库哈希保留，不自动重试或补记费用；没有将新图当作旧调用恢复。完整应用跨进程重开原 QA 库的未验证边界仍保留，详见[直连与恢复核验](ui-image-ark-plan-2026-10-23.md)。
- 队列关闭竞争已通过先失败、后通过的阻塞查询回归验证；关闭先等待正在领取的队列，再等待 active 任务，不改变现有任务状态、回执或重试规则。
- 发布所用两项临时 GitHub DockerHub secret 已删除并确认不存在，其他凭据未修改。真实供应商 Key 未写入源码、日志或发布包。生产站点及模型配置未部署或改写。

原始日志、数据库、JSON、OCI 元数据、图片与下载归档位于忽略目录 `artifacts/verification/ark-plan-image/`、`artifacts/verification/release-0.2.10/`。本页仅提交审核摘要。

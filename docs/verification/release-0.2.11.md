# Doca 0.2.11 发布验收

2026-10-23 已发布 [GitHub v0.2.11](https://github.com/smartdoca/doca/releases/tag/v0.2.11) 和 [Docker Hub](https://hub.docker.com/r/smartdoca/doca/tags)。正式 tag 与镜像构建提交均为 `476e8eda43013bc3bb9da6947ab6dd34db5e15a7`；[应用与编辑器 PR84](https://github.com/smartdoca/doca/pull/84)、[部署版本 PR85](https://github.com/smartdoca/doca/pull/85) 已合并。发布后的验收文档不移动正式 tag。

## npm 与实际宿主

- [Canvas 0.5.15 npm](https://www.npmjs.com/package/@smartdoca/canvas/v/0.5.15) 与 [GitHub](https://github.com/smartdoca/canvas/releases/tag/v0.5.15) 已发布。Doca 的 155 个安装文件全部匹配正式归档，SHA256 `28a65c0947f45f0aedec69a645d1205da6f3e72a1e185c1db7a8d3f0d00bd96e`。公开 exports、依赖和 124 个声明文件与 0.5.14 相同，运行时仅 index.js 改变。源码 lint、类型、30 个模型/presence 测试及 10 个框选浏览器测试通过。
- [Sheet 0.2.12 npm](https://www.npmjs.com/package/@smartdoca/sheet/v/0.2.12) 与 [GitHub](https://github.com/smartdoca/sheet/releases/tag/v0.2.12) 已发布。75 个安装文件匹配正式归档，SHA256 `5bf935b9083f832ebdf3e583c79a3cfc3c6ed3f282a45469c321d796737ced35`。公开 exports、依赖和 14 个声明文件与 0.2.11 相同，变化限于 Yjs ESM/CJS 及其 sourcemap；model、preferences 和 XLSX 字节不变。171 项源码测试通过、1 项既有性能测试按配置跳过。
- Doca 精确锁定上述版本，冻结安装及 2046 条依赖策略检查通过，其他依赖版本未变。最终全量为 3335 通过、11 按配置跳过，无失败；TypeScript、正式扩展/Canvas renderer/Web 构建、npm 来源及双语文档检查通过。[PG17/18 主分支矩阵](https://github.com/smartdoca/doca/actions/runs/39956243785) 通过；其后只修改 Compose 和部署文档，应用及数据库代码未变。
- 最终编译 Web 的原生画布表格框选、新表格框选和便签 @/卡片/编辑/撤销/对端同步/刷新通过。五格式评论、慢发送/刷新、标注显隐及布局通过，5 个客户端空闲 61,010ms，正文/WS update 为零，DOM 未重挂，浏览器错误为空。
- 实际 Doca 双页筛选确认与原生粘贴追加均只增加一次服务端 seq，epoch 保持，接收端无回声；单步撤销/重做和刷新恢复通过。4 个客户端空闲 61,075ms 无内容写入或浏览器错误，实际画面中第 41/42 行的“已解决”被隐藏。初稿测试数据导致清除条件的诊断限制已在[筛选验收](sheet-filter-range-2026-10-23.md)单独说明。
- 真实 Chromium MV3 浏览器助手回归通过：三次模拟任务分别读取新标签页/站内路由内容；图片读取失败不阻断 AI，完整收录继续拒绝缺图，登录/旧脚本刷新正常。未调用真实付费模型或操作用户文档。富文本与 Markdown 标题实际浏览器 8 项检查也通过，包括保存失败保留草稿/重试、取消、双页同步、格式保留及只读拒绝编辑。

## 双架构镜像与独立公开核验

[原生镜像流水线 39956808918](https://github.com/smartdoca/doca/actions/runs/39956808918) 通过。amd64、arm64 均验证原图字节、登录/退出/撤权、UID1000、Chromium namespace/seccomp 沙箱 PDF、Canvas 真实像素及 DOCX/XLSX→PDF。只读根目录、无网络和临时 home 保持启用；运行文件、Web 与编辑器入口逐项对照源码构建通过，供应商调用为零。

本机 buildx 读取曾返回 EOF，原失败日志保留。独立复核改用官方 Registry 只读 HTTP API，校验每个原始 manifest 的 SHA256 和 Docker-Content-Digest，再比对已验收摘要；未将本机 CLI 失败记为通过。

流水线完成后再次独立读取公开 OCI 索引及两个子 manifest/config；`0.2.11` 和 `latest` 均指向：

`sha256:1ea1ac8e35eb0d8403fca611e03e318f1b8f716390aebbb3c2fb1f46fcd5e47a`

| 架构 | manifest 摘要 | 完整压缩层字节 | 保留 0.2.10 时新增唯一层字节 |
| --- | --- | ---: | ---: |
| amd64 | `sha256:a27cac3921fb94f3af28488309aa5dbf8217ad6c3c70ff292691ae181b3e53ef` | 707,926,769 | 116,603,570 |
| arm64 | `sha256:c95c84657e0602fd4349d201d886af563c42833910deccc493b9b9b8d130e8e3` | 704,728,404 | 114,348,384 |

增量数字要求同架构 0.2.10 旧层仍在本机，按缺少的唯一压缩 blob 求和，不包含 manifest/config 和传输头部；首次拉取需要完整镜像。原 Chromium、Office、中文字体和编辑器能力保留。

## GitHub 附件与发布更正

[正式 Release 流水线 39956802085](https://github.com/smartdoca/doca/actions/runs/39956802085) 通过。三个公开附件均已实际下载并校验 GitHub SHA256、大小和部署包校验文件；Web 的 478 个文件与本地最终构建逐字节一致，部署包 10 个允许文件与相同正式提交生成的包逐字节一致，本地 tar 使用 COPYFILE_DISABLE=1。

| 附件 | 字节 | SHA256 |
| --- | ---: | --- |
| doca-deploy-v0.2.11.tar.gz | 18,416 | `00f6951857613f2b4d2a1465609e4f4cd3afa9c6b141854e7e617e47e4d580bd` |
| doca-deploy-v0.2.11.tar.gz.sha256 | 93 | `d25046072ca799c7ded3ed63c326131538a87464879c6cb0bb1e360921966215` |
| doca-web-assets-v0.2.11.tar.gz | 17,162,071 | `3a71bcdfa2e5ed9ecfa2ccf037594d55f34e7678064cbf90484ff4624c901b2a` |

首次部署打包因 Compose 仍指向 0.2.10 被拒绝，未创建 GitHub Release；初始镜像工作流已取消。确认没有公开 0.2.11 镜像或 GitHub Release 后，修正 Compose 和中英文部署示例，以精确 lease 校正本次尚未发布的 tag，再从上述正式提交重新发布。正式发布后 tag 保持不变，旧版本和用户数据均未改写。

Canvas 的 tag 工作流因压缩归档身份检查失败。它通过审核 tarball 发布，因此没有 gitHead；本机重包与正式归档 integrity 相同。另用独立 npm10.9.9 容器重包，155 个文件内容及权限相同，压缩包哈希与 npm11.12.1 不同；GitHub Release 在该逐文件审计后手动创建。不将失败的自动化检查记为通过，也不声称已逐文件比较该失败 CI 的重新编译产物。Sheet 的首次自动发布缺凭据；本机目录发布后，工作流按正式 gitHead 复核并成功发布 GitHub Release。

## 保留与范围

相对 0.2.10 没有新增数据库结构、兼容适配、格式转换、历史字段回填或 baseline/epoch/checkpoint/pending-update 重写。已批准的筛选规则使用既有 schema6；已有历史读取、显示默认值、鉴权及 AI 队列规则保持原路径。保留前一部署、依赖/锁文件、数据库/文件卷、部署主密钥及所有后续写入。未部署生产站点，未修改用户数据库或生产模型配置。

临时 GitHub Docker Hub 发布 secret 已删除并确认不存在，其他凭据保持原状。原始日志、JSON、归档和截图位于忽略目录 `artifacts/verification/release-0.2.11/`，本页仅为审核摘要。细节另见[评论验收](editor-comments-2026-10-23.md)、[浏览器助手](browser-assistant-fixes-2026-10-23.md)和[升级规范](../database-schema-evolution.zh-CN.md)。

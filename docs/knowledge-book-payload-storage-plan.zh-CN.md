# 知识册正文对象存储实施方案

[English](knowledge-book-payload-storage-plan.md)

状态：2026-10-12 完整升级方案已获用户明确同意；2026-10-13 实现与隔离验收已完成。未部署、未转换用户数据库。验收记录与执行步骤见[验证及运维](knowledge-book-storage-verification.zh-CN.md)。

## 范围与保留项

以下原有可选无损转换的旧格式为宿主 0.1.22 所用的数据库代际 `doca-2026-10-09-history-storage-v1`，以及 knowledge_book_node_runs.output、knowledge_book_runs.artifact、knowledge_book_releases.artifact 中的完整 JSON。覆盖所有知识册及其成功、失败、取消、等待人工处理的历史内容，包括回收站中的册。

工作流配置、来源及其版本、反馈、状态、运行/发布/节点 ID、权限、通知、审核决定、审计、文档历史、插件私有数据和已有存储配置都保留。原始来源不另行抓取或重新归档。未生成的节点输出空字符串、未形成的运行成果 NULL 保留其原有含义，不用新字段默认值重建旧内容。

发布成果仍是现有 BookArtifact 第 1 版；外部正文、反馈锚点、段落 ID 和溯源图结构保持不变。现有完整读取接口继续返回完整成果，新增摘要读取供界面和助手轮询。既有 120,000 来源字符、单次模型上下文/输出及发布前 10,000,000 JSON 字符保护都按还原后的内容检查。

## 无损正文共享

对完整 JSON 的原始 UTF-8 字节进行可逆分片：较长的正文字符串（初始阈值 1 KiB，包含原始 JSON 转义）按内容哈希共享；短字段和标点保存在分片清单中。必要时把大字符串和清单继续分片，使每个物理对象不超过现有宿主对象存储能力。各片 gzip 压缩，记录压缩前后长度和 SHA-256。

相同正文在同一本册的多个节点、成果、溯源 label 中只保存一份；完全相同的运行成果和发布成果共享同一个根清单。跨知识册不共享对象，避免权限边界及指纹侧信道。读取合并原始字节后再 JSON.parse，因此不会删掉正文、重写转义、排序字段、改变图表或填补旧字段。

新物理键为 `host/knowledge-books/<bookId>/<uploadId>/<compressedSha256>.gz`，只接受合法 UUID 和 SHA-256。复用现有 createHostFileStore 的配置、凭据、不可变上传和回读校验；不经公开 CDN，也不使用用户上传或插件命名空间。后端继续由部署配置选择 local/S3。

## 目标数据库结构

只在最新 createCurrentStructure 及其知识册辅助函数中声明目标 DDL，新增表在 schemaEvolution 登记。旧三张表的 SQL 列类型、NULL 约束和现有索引不变；其非空正文在显式转换后改存严格引用标记。新增表均从空表开始，没有历史默认值、旧字段兜底或自动正文回填。

| 新表 | 字段与用途 | 关键约束 |
| --- | --- | --- |
| knowledge_book_payload_objects | book_id UUID；kind（data/index/root）；sha256（原始对象哈希）；store_id varchar(64)；object_key text；stored_sha256 varchar(64)；size/raw_size bigint；state（ready/garbage）；created_at/updated_at ISO 时间 | 主键 (book_id,kind,sha256)，唯一 (store_id,object_key)，大小为正；对象元数据不随册删除而丢失 |
| knowledge_book_payload_edges | book_id；parent_kind/parent_sha256；child_kind/child_sha256 | 五字段主键，父/子复合外键指向对象注册表；记录清单依赖，垃圾回收可查询完整可达关系 |
| knowledge_book_payload_references | book_id；owner_kind（node/run/release）；owner_id UUID；node_id varchar(100)；root_kind（固定 root，以建立复合外键）；root_sha256；raw_sha256；raw_size bigint；access_manifest text；summary text；created_at/updated_at | 主键 (book_id,owner_kind,owner_id,node_id)；book_id 外键随册永久删除级联；根清单外键；只有 node 的 node_id 非空，run/release 显式使用空字符串 |
| knowledge_book_payload_operations | id UUID；book_id；owner_kind/owner_id/node_id；expected_sha256；definition text；lease_id UUID；lease_until；state（uploading/committed/garbage/deleted）；created_at/updated_at | 主键 id；版本化 definition 仅保存依赖、对象键、长度、哈希等元数据；上传前登记，不存正文；删除册后仍保留未完成上传和清理依据 |

access_manifest 的第 1 版保存去重后的真实来源权限引用（sourceId、sourceVersion、reference、可选 contentRef）；summary 的第 1 版保存真实页目录、段落/知识判断/证据数量和验收状态。无需正文就可以复验当前权限和返回轮询信息。缺失或未知版本明确拒绝，不能解释为没有来源。

旧正文列的新标记形如 `{type:"knowledge_book_payload_ref",version:1,bookId,ownerKind,ownerId,nodeId,rootSha256,rawSha256,rawSize}`。标记必须与对应引用行一致，不能借用别的册的对象。空字符串/NULL 仅代表原先就没有正文的记录。

## 写入、读取与清理

1. 校验身份、来源和运行租约，登记带租约的上传操作及其全部对象依赖，随后执行外部 I/O。先上传、回读、解压和哈希验证每个对象。
2. 在同一本册的数据库事务锁下安装对象/依赖、引用、正文标记及节点/发布事实；复验运行租约和原输入。失败不得发布或覆盖已完成节点。相同对象并发上传只选一个注册对象，多余物理对象进入清理队列。
3. 读取先复验册权限和 access_manifest 中全部来源权限；再按需要取正文，并验证引用、根清单、分片及还原字节哈希。对外返回前再次检查受影响权限。对象缺失、损坏或未知格式明确报错，保留上次发布及全部引用。
4. 不可变字节可在单个进程内做有界缓存；命中缓存仍须复验权限。轮询使用数据库摘要，展开候选成果或阅读正文时才取完整内容。
5. 只有从现存引用及有效上传操作都不可达的对象才允许清理。册进入回收站仍保留内容；用户永久删除时释放引用并登记持久化清理任务。清理复验可达关系与上传状态，失败重复执行，不能清掉共享对象或忘记尚未完成的上传键。不增加历史保留 TTL，不使用本地时间目录作为持久化替代。

## 显式历史转换与启动门禁

目标代际为 `doca-2026-10-12-book-payload-storage-v1`。2026-10-13 用户最终同意仅对齐结构，旧 SQL 知识册生成记录原样留下、按需人工处理。0.1.24 对准确的 `doca-2026-10-09-history-storage-v1` 沿用最新 DDL 和普通对比器，在同一 schema 锁事务中对齐结构并记录目标代际。全部业务行，包括运行、输出、发布成果、人工待办和当前发布指针原样保留；不新增单独清理、自动正文转换或旧正文运行时适配。新成果采用原生对象引用，旧 SQL 成果可能需人工处理；已有 0.1.23 对象数据保持完整可读。检查或写入失败整体回滚，重复／并发启动幂等。未知、更早和转换中断代际继续拒绝，这项例外不授权删除其他未知表。部署前停掉全部旧宿主并备份 SQL，所有实例和 Web 构建一起更新；结构对齐期间不上传对象、不运行任务、不自动 VACUUM。

下方既有逐字节离线转换保留为需将旧成果继续保留为可用原生格式时的可选方案，须在首次启动前执行；结构对齐后原转换的源代际不再匹配。转换中断检查和恢复规则保留。

`knowledge-books:storage upgrade` 默认只输出预检与计划，`--apply` 才执行。只支持上述确切旧代际；更早数据库先完成其已批准的历史升级，不能直接任意跨代际转换。

执行前停掉所有宿主并备份数据库与私有存储。预检全部正文格式、引用、来源清单、目标结构差异和空间需求；存在未知格式、损坏数据、待审结构差异或仍在运行的流水线时拒绝，保留原数据，不擅自取消任务或重置状态。

结构检查、允许的新增表、复查和 footprint 记录在 schema 锁下事务执行。先保存原 footprint/转换清单，再将代际设为 `doca-2026-10-12-book-payload-upgrade-in-progress-v1`，阻止任何宿主启动。逐个上传并回读完整原 JSON，要求还原 UTF-8 字节及 SHA-256 与 SQL 原文完全一致，然后事务性切换该记录。中断后的显式命令使用原转换状态和上传记录继续；普通启动仍拒绝该标记。

完成后验证所有非空正文均为新引用、引用与对象依赖完整，复查目标 DDL 并记录 footprint，最后事务性切换到目标代际。原正文仅在已验证并已建立不可变对象引用后离开 SQL；任何检查失败都停止转换，不删除或重置已有内容。SQLite 已释放页不会自动缩小数据库文件；部署后是否离线 VACUUM 另行决定，不能自动执行。

## 回退与验证

回退同样先停写，并以新建、权限受限的 manifest 文件保留所有对象及转换记录。代际设为 `doca-2026-10-12-book-payload-rollback-in-progress-v1` 后，逐个解码并回填原 JSON。包括升级后产生的新成果、失败节点、处理意见和权限，不能用恢复旧备份来丢弃后续写入。

全部引用还原并验证后，显式撤销新增的存储结构，恢复原兼容代际和经检查的 footprint。云端对象保留为恢复材料，不在回退命令中清空；中断可以继续。回退目标是正文 API 相同的升级前 0.1.22 宿主，不承诺任意历史版本回退。既有文档历史对象存储与其升级/回退协议不受此操作影响。

验收包括实际 0.1.22 镜像生成的旧数据，以及隔离 SQLite、PostgreSQL 17/18：空库、带成功/失败/人工待办的旧库、精确字节往返、跨节点去重、同册/跨册隔离、重复/并发上传、上传或事务中断、清理与迟到返回、权限撤销、缓存权限、回收站/永久删除、重复启动、损坏/未知格式拒绝无部分写入，以及升级后新写入的完整回退。记录代表性正文的 SQL 和对象实际字节变化；不能以重复合成文本的 gzip 比例宣称生产节省幅度。

实现细节：单个原始分片不超过 1 MiB，索引页最多 128 个子引用；压缩字节缓存上限为每个数据库运行域 32 MiB。运行成果、发布成果和发布节点输出在同一本册锁下共同提交。完成上传后，已安装的依赖由对象与边表保留，操作清单只留下并发竞争产生的多余物理上传键，避免完成日志重复保存整份索引。摘要中的来源库存仅用于断点验证，不保存正文。

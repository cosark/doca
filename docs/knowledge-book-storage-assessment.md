# Knowledge-book storage assessment

[中文](knowledge-book-storage-assessment.zh-CN.md)

Assessed on 2026-10-12 and implemented/verified on 2026-10-13 under the explicitly approved plan. Existing host private local/S3 storage now pools same-book raw JSON tokens with lossless reconstruction. No production book or database was migrated.

## Existing limits

`book_size_limit` groups several HTTP 413 causes, including source/input/output budgets and release size; it does not establish a book-wide quota of a few kilobytes. The existing publication guard limits the artifact JSON to 10,000,000 characters. A source group is limited to 120,000 characters, a manual binding to 60,000 characters, and a model response to 500,000 characters. The combined-node ceiling was removed on 2026-10-14 under the approved batched execution plan. Model input uses its configured context; each response requests at most `min(maxOutput, 32,000)` tokens. Version 1 allows 1,000 claims, 200 pages, 200 paragraphs/page and 12,000 characters/paragraph. Writing batches expand the possible body size without removing these guards. Detailed acceptance is now batched; global acceptance receives host metrics, directory metadata and hierarchically bounded review summaries, not the complete body. Each request and metadata projection still must fit the configured context; unlimited books are not promised.

New writing requests subdivide at complete claims/paragraphs after an input budget or truncated-output failure. Historical configurations, source bindings, node JSON and version 1 artifacts remain unchanged. Resume retains completed nodes; unfinished batches within a failed node are regenerated.

## Database duplication

Node outputs retain upstream evidence, claims, pages and checks through synthesis, organization, acceptance and publication. The run artifact and immutable release each retain the complete artifact. Provenance stores paragraph Markdown in labels and cited text again in labels/details. Source and configuration histories are also retained; they must not be cleaned up without agreement. Original source bodies are not separately archived, and short numeric audit logs are not usually the main contributor.

The synthetic six-chapter fixture uses 80,040 body characters, the current seven-node workflow and the actual `createBookProvenance` implementation:

| Payload | UTF-8 bytes |
| --- | ---: |
| Body strings | 239,040 |
| Each synthesis/organization/acceptance/publication output | 250,903 |
| Run artifact with provenance | 559,986 |
| Release artifact | 559,986 |
| All node outputs plus run and release artifacts | 2,129,658 |

This illustrates about 8.9 times the body-string bytes, excluding source history, SQL pages, indexes, WAL and backups. It is not a production database measurement. Repeated synthetic prose makes its gzip ratio unsuitable for estimating actual savings or costs. See `docs/verification/knowledge-book-reliability-2026-10-12/storage-size.json`.

## Implemented storage and conversion

SQL retains workflow/status/leases, tasks, permission manifests, summaries, object indexes and durable upload/cleanup journals. Large node and run/release JSON uses the host private store. Raw escaped JSON string tokens are shared by content hash within a book; external version 1 artifacts and provenance remain unchanged. Bounded chunks/indexes are gzip-compressed and verified by size/SHA-256. Identical run/release artifacts share roots.

Existing local/S3 configuration and immutable upload/readback are reused without module-owned credentials or public body URLs. Upload verification happens outside SQL transactions; references and completion facts commit under a book lock with current worker leases. Missing/corrupt content fails while retaining references. Byte caches never cache authorization. Polling uses SQL summaries and bodies load on demand. Trash retains content; permanent purge releases references and unreachable objects are cleaned. No historical TTL is added.

The complete conversion plan was explicitly approved. Current generation is `doca-2026-10-12-book-payload-storage-v1`; released 0.1.22 databases on `doca-2026-10-09-history-storage-v1` require explicit offline conversion of every original JSON body. Startup neither migrates nor dual-reads. Unknown formats, review-required structures and running jobs block conversion. Rollback restores newer writes while preserving cloud/recovery materials. See the [implementation plan](knowledge-book-payload-storage-plan.md).

Actual old-image SQLite/PostgreSQL 17/PostgreSQL 18 fixtures each verified all 20 bodies byte exactly through upgrade and rollback. 3,698,834 original SQL bytes became 7,170 reference bytes plus roughly 403–404 KB of serialized metadata; registered compressed objects total roughly 95 KB. Metadata serialization is not physical SQL/WAL size, and repeated synthetic prose cannot predict production compression. See [verification and operations](knowledge-book-storage-verification.md).

Costs include object latency, network failure, cross-store commits and ongoing cleanup. Source/configuration history remains in SQL and cannot be deleted merely to save space. Measure representative production books/backups/WAL and storage billing separately.

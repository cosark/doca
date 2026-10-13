# Knowledge-book payload storage implementation plan

[中文](knowledge-book-payload-storage-plan.zh-CN.md)

Status: The complete upgrade plan was explicitly approved on 2026-10-12. Implementation and isolated verification completed on 2026-10-13. No deployment or user database conversion has been performed. See [verification and operations](knowledge-book-storage-verification.md).

## Scope and lossless representation

For the existing optional lossless conversion, the input is host 0.1.22 generation `doca-2026-10-09-history-storage-v1`, with full JSON in knowledge_book_node_runs.output, knowledge_book_runs.artifact and knowledge_book_releases.artifact. All books and retained outcomes, including trash and failures/human waits, are covered. Keep configurations, source versions, feedback, IDs, states, permissions, notifications, audit, decisions, document history, plugin data and storage configuration. Empty node output and NULL run artifact keep their existing absence meaning.

Externally, BookArtifact remains version 1 with the same text, IDs, anchors and provenance structure. Existing full-read APIs remain; add summary reads for polling. Existing source/model guards and the 10,000,000-JSON-character publication limit apply to the reconstructed content.

Reversibly segment original UTF-8 JSON bytes. Share long JSON string tokens, initially at least 1 KiB including their original escaping, by content hash within one book. Keep short fields/punctuation in manifests. Further segment large strings/manifests to fit the host object store; gzip and record raw/compressed sizes and SHA-256. Identical node/release/provenance body strings share data; byte-identical run/release artifacts share a root manifest. No cross-book deduplication. Concatenate original bytes before JSON.parse, without reformatting or invented values.

Private keys are `host/knowledge-books/<bookId>/<uploadId>/<compressedSha256>.gz`, using strict UUID/hash validation. Reuse createHostFileStore and its configured local/S3 backend, credentials, immutable upload and verified readback. No public CDN, user-upload or plugin namespace.

## Target structure

Declare only the latest target DDL in createCurrentStructure and knowledge-book helpers; register new tables in schemaEvolution. Existing SQL columns/nullability/indexes remain unchanged, but nonempty body columns become strict reference markers after explicit conversion. All new tables begin empty, with no historical defaults or old-format fallback.

| Table | Fields | Constraints |
| --- | --- | --- |
| knowledge_book_payload_objects | book_id UUID; kind data/index/root; sha256 raw hash; store_id varchar(64); object_key text; stored_sha256; size/raw_size bigint; state ready/garbage; created_at/updated_at | PK (book_id,kind,sha256), unique (store_id,object_key), positive sizes; metadata survives book deletion |
| knowledge_book_payload_edges | book_id; parent_kind/parent_sha256; child_kind/child_sha256 | Five-field PK and composite object foreign keys; tracks manifest reachability |
| knowledge_book_payload_references | book_id; owner_kind node/run/release; owner_id UUID; node_id varchar(100); root_sha256; raw_sha256; raw_size; access_manifest; summary; created_at/updated_at | PK (book_id,owner_kind,owner_id,node_id); book FK cascades on permanent deletion; root FK; node_id nonempty only for node owners, explicitly empty for run/release owners |
| knowledge_book_payload_operations | id UUID; book_id; owner_kind/owner_id/node_id; expected_sha256; definition; lease_id/lease_until; state uploading/committed/garbage/deleted; created_at/updated_at | PK id; versioned definition stores dependency/key/size/hash metadata only; reserve before I/O; preserve unfinished upload/cleanup facts after book deletion |

Version 1 access manifests contain the actual sourceId/sourceVersion/reference/optional contentRef authorization inputs. Version 1 summaries contain actual page manifests, paragraph/claim/evidence counts and check states. Missing/unknown versions fail rather than becoming an empty source list. Body markers contain type `knowledge_book_payload_ref`, version 1, book/owner/node identity, rootSha256, rawSha256 and rawSize, and must match their reference row.

## Lifecycle

Authorize actor, sources and run lease; reserve a leased upload operation and dependencies before external I/O. Upload, reread, decompress and hash-check objects. Under a per-book database transaction lock, install object/dependency/reference records, body markers and execution/publication facts, rechecking the run lease and original inputs. Concurrent duplicate physical uploads select one registered object and journal the excess for cleanup.

Reads authorize the book and every source access manifest before fetching bodies, verify references/manifests/chunks/restored bytes, and recheck affected permissions before delivery. Missing/corrupt/unknown objects fail explicitly while retaining releases/references. Use bounded process-local immutable-byte caches with authorization on every read. Poll SQL summaries and fetch full content on expansion/reading.

Only objects unreachable from live references and active upload operations may be collected. Trash retains contents; permanent deletion releases references and journals cleanup. Recheck reachability/upload state, retry failures, retain unfinished upload keys, and never remove a shared object. No new history TTL or durable dependence on a previous local task directory.

## Conversion gate and recovery

Target generation: `doca-2026-10-12-book-payload-storage-v1`. On 2026-10-13 the user approved schema-only startup alignment with old SQL-generated book rows left untouched for manual handling. Starting with 0.1.24, exact `doca-2026-10-09-history-storage-v1` databases use the ordinary current-DDL reconciler and record the target generation under the same schema lock/transaction. Every business row, including runs, outputs, releases, human tasks and publication pointers, remains unchanged. There is no separate data cleanup, automatic body conversion or legacy runtime reader. New outcomes use native object references; old SQL outcomes can require manual handling. Existing 0.1.23 object data remains readable and untouched. Failed checks or writes roll back all structure/generation changes; repeated/concurrent startup is idempotent. Unknown, earlier and interrupted generations still stop. This exception does not authorize deleting unrelated unknown tables. Stop every old host and back up SQL before deploying; update all host and web builds together. No object uploads, automatic VACUUM or worker execution occur during reconciliation.

The existing byte-exact offline conversion below remains optional if old outcomes must be retained in the usable native format. Run it before first startup; after schema alignment its source generation no longer applies. Its interrupted-generation gates and recovery remain unchanged.

`knowledge-books:storage upgrade` defaults to a dry-run plan; only `--apply` performs changes. It accepts only the exact preceding generation. Earlier generations first use their separately approved history upgrade. Stop every host and back up SQL/object storage. Preflight all payloads, references, ACL metadata, structure differences and space; reject unknown/corrupt formats, review-required structure or still-running pipelines without changing them.

Inspect/add/reinspect/record structure transactionally under the schema lock. Save the original footprint/conversion manifest and install generation `doca-2026-10-12-book-payload-upgrade-in-progress-v1` before record conversion, blocking normal startup. Upload/reread each original JSON and require byte-exact UTF-8/SHA-256 equality before switching its SQL record transactionally. Interrupted explicit conversions resume from their journal; startup still rejects the in-progress marker. Validate every nonempty reference/dependency and the target DDL/footprint before switching to the target generation. Never delete/reset data to bypass a failed check. SQL body bytes leave only after verified durable preservation. SQLite file compaction is a separate maintenance decision; do not run VACUUM automatically.

Rollback stops writes, exports object/journal records to a new protected manifest file, and installs `doca-2026-10-12-book-payload-rollback-in-progress-v1`. Decode and restore all original JSON, including post-upgrade outcomes, decisions and permissions; do not restore an old SQL backup and lose subsequent writes. Once all references are restored/validated, explicitly remove storage extension structures and restore the reviewed original generation/footprint. Keep cloud objects as recovery material. Rollback supports the pre-storage 0.1.22 host with the same body API, not arbitrary older versions. Document-history storage/upgrade behavior is unchanged.

Acceptance covers actual 0.1.22-image data and isolated SQLite/PostgreSQL 17/18: fresh and retained success/failure/manual-wait data; byte-exact roundtrips; dedup/isolation; repeated/concurrent uploads; I/O/transaction interruption; cleanup/late returns; revocation/cache permission; trash/purge; repeated startup; unchanged-data rejection of malformed/unknown formats; and rollback with new writes. Measure representative SQL/object bytes; repeated synthetic gzip ratios are not production savings estimates.

Implementation details: raw chunks are bounded to 1 MiB and index pages to 128 children. Compressed byte caches are limited to 32 MiB per database runtime scope. Run/release artifacts and the publication-node output commit together under the book lock. Installed dependencies remain in objects/edges; completed operation definitions keep only losing concurrent physical uploads, avoiding duplicated installed indexes. References include a fixed `root_kind = root` for their composite root foreign key. Source inventory in summaries supports checkpoint validation and contains no bodies.

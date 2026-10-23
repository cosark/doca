# Browser quick-note verification

> 原始截图、JSON 和运行日志保存在本地忽略目录 `artifacts/verification/issue-tracker-2026-10-21/`；下文“本地产物”和“本地图片”的相对路径以该目录为基准，不随 Git 提交。原验收日期、结果和指纹保持原记录，仅整理附件位置。

Checklist 2.0 row 6: the user approved selecting an already-authorized existing rich-text or Markdown document and appending plain text without AI, preserving original content and keeping the target choice only in memory while the extension is open.

The host implementation is isolated in `browser-quick-note.ts`, `append-plain-text.ts` and the existing browser-clipper route registration. The already-verified shared AI delivery/store/runtime files and generated extension are unchanged by this work. The [API and failure contract](../../browser-quick-note.md) describes the exact profile boundary, ephemeral tickets, native receipts and response-loss behavior.

## Automated verification

`tests/browser-quick-note.test.ts` covers exact current append-profile targets, strict payloads, original rich-text/Markdown preservation, repeated native receipt acknowledgement, concurrent prepare/commit and separate notes, cross-connection rejection, live profile changes, token rotation and lock-wait revocation, assistant-disabled operation without AI jobs, ticket expiration/restart, accepted-ID regeneration refusal, UTF-8 limits, two-actor collaboration and edit-permission removal, capacity refusal preserving an existing ticket, actual website-session expiry and native epoch mismatch.

The adjacent existing `tests/browser-clipper.test.ts` is run together to check that collection behavior remains unchanged. Verification uses isolated SQLite databases and synthetic documents. This is not a new database/schema upgrade and does not claim a new persistence compatibility generation.

The focused run passed **28 tests** across these two files (14 new quick-note tests and 14 existing collection tests). The complete workspace TypeScript check also passed. The coordinator records the final full-workspace run separately.

## Browser verification

The host integration browser script is `scripts/qa-browser-quick-note.mts`, with isolated output in `.local/browser-quick-note-2026-10-22`. The actual Chrome run passed all **three groups** with zero page errors: rich text, Markdown and authorization boundaries. The result receipt（本地产物：`browser-quick-note/results.json`） records `extensionBundleExecuted: false`, zero model calls, zero AI calls/jobs and zero clip receipts.

Each format used two actual website editor pages. The first commit reached the real server and completed, then its browser response was deliberately lost. Retrying the same ticket returned `changed: false`, the same sequence and exactly one native receipt. Both pages received the note through native notification and displayed it once after reload. Original blocks/source text and the native epoch were preserved; preparation did not change these already-opened documents. Rich-text sequence was 1→2 and Markdown sequence was 0→1. See rich-text peer live（本地产物：`browser-quick-note/rich_text-peer-live.png`）, rich-text peer reloaded（本地产物：`browser-quick-note/rich_text-peer-reloaded.png`）, Markdown peer live（本地产物：`browser-quick-note/markdown-peer-live.png`） and Markdown peer reloaded（本地产物：`browser-quick-note/markdown-peer-reloaded.png`）.

The same browser run found only the two enabled append targets. A foreign connection received 409; arbitrary target fields in prepare and commit received 400. Changing the live profile target/revision made its old ticket fail 409 and left both document states byte-for-byte unchanged. See preserved original target（本地产物：`browser-quick-note/authorization-boundaries-original-preserved.png`）.

Reproduce with `node_modules/.bin/tsx scripts/qa-browser-quick-note.mts`; the default port is 39507, overridable with `DOCA_QA_PORT` and `DOCA_QA_OUTPUT`. The script closes its Chrome and server in `finally`. Extension popup/side-panel UI and the final installed MV3 bundle are verified separately by the extension owner; a host browser API check alone is not extension UI acceptance.

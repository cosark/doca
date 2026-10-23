# Browser quick-note extension verification

> 原始截图、JSON 和运行日志保存在本地忽略目录 `artifacts/verification/issue-tracker-2026-10-21/`；下文“本地产物”和“本地图片”的相对路径以该目录为基准，不随 Git 提交。原验收日期、结果和指纹保持原记录，仅整理附件位置。

The approved scope is an explicit existing rich-text or Markdown target from an enabled authorized append profile, with plain-text appends and no AI. Target, composer, request ID and ticket live only in the current extension view. This report verifies the installed MV3 package; the [host verification](browser-quick-note.md) separately verifies native two-page collaboration and backend boundaries.

The [current API and failure contract](../../browser-quick-note.md) is unchanged by extension integration. No database or receipt format, grant field, legacy reader, conversion or migration was added.

## Controlled tests

The final group passes **244 tests in 12 files**, including **64 background** and **52 UI** cases plus the host quick-note and adjacent capture/AI queue tests. Tests cover trusted-extension-only operations, exact origin/connection/token checks before dispatch and after headers/JSON, no generic resource proxy or automatic 401 replay, strict current input/response types, malformed acknowledgement preserving the input and ticket, lost-response replay with original bytes, later draft preservation, explicit selection, fresh-view memory and account/site/connection isolation. No input, target or ticket is written to browser storage. Unit log（本地产物：`browser-extension/unit-tests.txt`）, full TypeScript receipt（本地产物：`browser-extension/typecheck.json`）.

## Three actual MV3 runs

The frozen package and five QA/test inputs pass three consecutive native macOS Chrome for Testing151.0.7922.34 runs. Each uses a fresh temporary profile, isolated SQLite and synthetic documents. Machine summary（本地产物：`browser-extension/summary.json`） and source fingerprints（本地产物：`browser-extension/source-fingerprints.json`） record exact hashes; the original capture/AI cases remain in each full run.

- Rich text appends native paragraphs with literal text, line breaks, HTML and Markdown symbols while preserving old blocks and epoch. A real accepted commit loses its runtime acknowledgement; retry uses the same request ID/ticket, returns changed:false and the same sequence, and produces exactly one native receipt. A later composer draft remains.
- Markdown preserves the exact supplied ordinary source after the existing text, separated by two newlines. Rendering follows the existing Markdown editor. It produces one sequence increment and one native receipt.
- A real unknown-ticket commit returns409, preserving text and target link without automatic reprepare. This is a missing-ticket test, not a five-minute native expiry wait; expiry is covered by backend controlled tests.
- The platform disables a prepared target rule. Commit returns409, keeps the original document link and text, and does not retarget. Explicitly ending the attempt leaves an empty selection and disabled save until the user chooses a valid target.
- Reopening the view clears selection and draft. The quick-note phase records zero AI jobs/model calls, page snapshots, clip receipts and image assets. Failed IDs have no native receipt.

Every successful note is cross-checked against the actual document state, original content, native epoch/sequence and receipt table. Mock POST counts alone are not used as proof of idempotency. All receipt links are in the [main extension report](browser-extension.md).

## Visual and operational boundaries

The final run archives seven quick-note screenshots, including scrolled error-confirmation controls, within [38 successful screenshots](browser-extension-visual.md). Headless extension UI uses the same packaged UI page; native side-panel target inspection and OS shortcut routing remain limited as documented in the main report. No real model provider is called.

Server tickets remain process-local for five minutes. Restart, expiry or routing to another process can stop the attempt; the extension retains current input and asks the user to check the document. No automatic cross-process recovery or persistent draft queue is claimed. Closing the view discards its temporary state. Submission and GitHub/DockerHub publication remain owned by the coordinating Doca release task.

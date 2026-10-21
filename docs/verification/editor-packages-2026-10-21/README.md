# Editor package integration — 2026-10-21

Doca pins the published **Canvas 0.5.8** (from 0.5.6) and **Sheet 0.2.5** (from 0.2.4). The host adapters already match the public API; no product-source adapter change is needed. Existing unrelated workspace changes are preserved. This work does not release or deploy Doca and does not open user documents or databases.

## Package and protocol audit

[package-audit.json](package-audit.json) records official npm archive identities, SRI/SHA-256 hashes, exported declarations and runtime comparisons. Installed distribution files match the official archives byte for byte. Public APIs, exports and dependencies are unchanged. Canvas model and Sheet model/XLSX runtimes are unchanged; Sheet Yjs changes only the native filter projection/recalculation order. The two dependency pins and their integrity entries are the only lockfile changes.

Canvas includes 0.5.7's style, wheel, mention and redo corrections and embedded view controls, plus 0.5.8's unbound connector translation. Grid/background controls remain view state; explicit gestures use the native content transaction and undo path. Sheet restores a native filter before recalculation during combined cell/filter sync and refreshes unchanged criteria after recovery or sorting. Host resource/ACL, presence, anchors, outbox and durable ACK ownership remain unchanged.

No new compatibility behavior, stored-format conversion, historical-field default, SQL/schema change, baseline replacement or pending-message reset is introduced. Exact Canvas schema 1 and Sheet schema 6 negotiation stays in place. The audit found existing historical readers, virtual worksheet recovery, normalization and previously approved display rules; these remain in their established paths without redesign. English/Chinese source contracts and project/user skill references were synchronized.

## Verification

- Frozen pnpm install passes all **2,046** lockfile policy checks. Official-registry metadata requests repeatedly timed out; installation used npm mirror metadata with the same safety policies enabled. Both new package integrity values and installed files were independently checked against the official npm archives. No registry setting was saved in the repository. See [install.txt](install.txt).
- TypeScript, Canvas server-renderer build and Web production build pass. Existing Vite extension/chunk-size warnings remain.
- Thirteen host suites: **49 passed, one Redis test skipped** because `DOCA_TEST_REDIS_URL` is absent. Coverage includes actual released checkpoints, readonly guards, asset rejection, durable/duplicate ACK, replay without echo, delete-set resync, structural operations, stable anchors and XLSX import/export. See [host-tests.txt](host-tests.txt).
- Sheet's two native-filter regressions pass against both its source and the actual official 0.2.5 Yjs artifact. They cover combined filter/cell synchronization, repeated delivery, cell-only updates, undo/redo, filter removal, readonly checkpoint restoration, sorting and unchanged CRDT bytes/baseline.
- Canvas's changed connector/feedback/packaged-editor suites: **27 browser tests pass**, including six tests against its built distribution. That distribution matches the official 0.5.8 archive. Coverage includes manual/automatic/curved routes, zoomed nested translation, bound endpoints, semantic deletion/undo, styles, panning, mentions and idle redo preservation. See [package-tests.json](package-tests.json).
- Real Doca + Chromium uses an isolated in-memory SQLite database and temporary file store: [browser.json](browser.json). It covers released data without open/selection writes, native grid/background controls, resize and connector translation, one commit on connector release, undo/redo after idle, readonly/history authorized image copying, filter create/remove/recreate/reload, two inline image reloads and previews, no remote echo, and 60 seconds of idle/readonly/resize without content writes. The script uses the preview dialog's accessible name to support the current workspace image viewer.

Reproduce host browser checks with:

```sh
DOCA_QA_OUTPUT=.local/editor-packages-qa node --import tsx scripts/qa-editor-packages-2026-10-20.mts
```

The script creates only synthetic accounts/documents and removes its temporary file store. Native package tests are at Sheet revision `67f0b13` and Canvas revision `a075ce5`. This acceptance does not cover every spreadsheet operation, every canvas gesture, mobile browsers, production Redis, PostgreSQL or all clipboard permission failures. No database upgrade was introduced.

## Rollback

The previous manifest, workspace configuration, lockfile, installed package trees and verified previous registry archives are retained in `.local/editor-package-rollback-2026-10-21/`. The source baseline is `31fca12f48a54f1c2ce3caeec6a0d976e164ac4e`; the official previous-package integrity values are recorded in the audit. Restore only this package change while preserving unrelated work and later document writes; rebuild server and Web together. Package rollback does not authorize resetting data or guarantee identical rendering of later native edits.

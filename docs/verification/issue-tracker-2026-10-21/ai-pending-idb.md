# AI pending queue: approved transaction store

> 原始截图、JSON 和运行日志保存在本地忽略目录 `artifacts/verification/issue-tracker-2026-10-21/`；下文“本地产物”和“本地图片”的相对路径以该目录为基准，不随 Git 提交。原验收日期、结果和指纹保持原记录，仅整理附件位置。

The user explicitly approved this preservation and rollback plan twice on 2026-10-22. It replaces the localStorage whole-map writer after two real Chrome pages demonstrated a lost adopt/revived draft despite Web Locks. The original failed experiments remain private evidence; increasing a timeout was not a fix.

## Storage and isolation

New sends use IndexedDB database `doca-ai-pending`, database version **1**, object store `entries`, with compound key:

```text
[docaOrigin, userId, connectionId, messageId]
```

The `scope` index contains the first three fields. `docaOrigin` is the canonical target HTTP(S) Doca origin, including for an extension whose physical storage origin is `chrome-extension://…`. `userId` is the authenticated Doca account. The website uses the reserved `connectionId: "website"` and `profile: null`; the extension uses its actual connection and explicit `{id, revision}` profile. A profile change cannot reuse another profile's same-ID record. Its old pending messages remain stored rather than being rebound or captured with the new profile.

Each strict `recordVersion: 1` entry contains the scope, message ID, nullable session ID, complete immutable `PendingSendItem`, payload SHA256, `pending`/`accepted`/`withdrawn` state and timestamps. Accepted entries retain their server job ID. Approved legacy adoptions retain `{storageKey, sessionKey, hash}` provenance. Tombstones are retained without automatic expiry. Same ID with different payload, profile or source hash is a conflict; no tombstone hides a changed original item.

Known current upload metadata, including URL, extraction state, preview and description, remains part of the complete payload and its hash. Non-ready attachments cannot enter the new sendable queue. Unknown fields, malformed records, unsupported record/database versions and unexpected database structure are preserved and refused, without a lossy reader, implicit conversion or storage reset.

Every insert, null-session binding, accepted transition, withdrawal and promotion reads the current record and conditionally writes in one short `readwrite` transaction. The operation resolves only after `transaction.oncomplete`; request success alone cannot consume input. Hashing and network calls occur outside the transaction. A parked session network operation cannot hold a user-wide storage transaction.

The separate per-scope/session Web Lock serializes network delivery. It is not the storage atomicity mechanism. Without that sender lock, delivery stops while the durable record remains. Before capture/POST, the sender checks the mounted identity, current pending record and any legacy provenance, then performs exact server `pendingId` reconciliation. An already accepted job is not captured or submitted again, even if it is terminal. Conflicting/unverifiable content remains local. The normal website retains its authorized session behavior; embedded automatic delivery only considers the currently opened session and selected profile.

## Original 0.2.7 localStorage

The original `doca.ai.pending-send.<user>` values are read only. The extension's historical user key remains `browser:<account>:<connection>` for this legacy surface only. New messages do not write, remove, merge or automatically drain any old queue.

Recognized old items appear separately as “Previous pending messages.” The user explicitly continues or withdraws each one, confirms the current site/account/profile, and chooses the current model, scope, skills and web-search setting. Missing old settings are not guessed. Browser-assistant attachments or references outside its supported scope are retained and refused.

For a bound old item, Continue first reads the authoritative session with its original `pendingId`. A proven accepted item creates an accepted source tombstone directly; withdrawal creates a withdrawn source tombstone directly. Neither operation passes through a sendable pending state. Otherwise the complete explicitly selected payload is adopted using the original message ID. A draft is bound only after its new session is created. Other drafts and profiles are not automatically adopted.

The legacy source is checked again after the server read and before a resumed POST. Changed, unknown, duplicated or missing same-ID source data blocks sending and remains untouched. This does not claim a distributed transaction across localStorage and IndexedDB; closing all old senders is a required operational boundary.

## Failures, upgrade and rollback

Unavailable, blocked, quota-failed or aborted IDB writes preserve the composer and existing records. There is no localStorage or memory-only fallback. For text/ready-attachment sends, these failures occur before any session/message POST or capture. For a local file that has not finished uploading, session creation and upload can precede the first complete queue record; the composer remains until completion, and a later queue failure still makes **zero model-message POSTs**, rather than claiming zero upload requests. An unprepared local file is never replayed as an attachment-free pending message.

Before upgrading or rolling back, stop queue sends and close **all** older website pages and extensions. Concurrent 0.2.7/new senders are unsupported: old clients cannot see IDB withdrawal tombstones. No server generation gate was introduced, so a running old sender cannot be made safe by this new client.

Rollback stops the new sender and preserves both stores, all tombstones and all later data. It does not export back to localStorage, restore an old database backup or automatically re-enable the old queue sender. An old binary without a safe sender-disable facility cannot resume queue sending. Server tables, chat history, documents, collaboration data and existing permissions are not converted.

## Extension handoff and readonly probe

`mountBrowserAssistant` keeps its existing config API: `origin`, actual `userId`, `connectionId`, and `profile.id/revision` provide the new store identity. No token, cookie or capture content is added to the record scope. `onSessionChange` continues to report the created/bound session. The extension owner must rebuild the shared UI and repeat final MV3 acceptance after source freeze.

For an isolated QA account, a readonly Chrome probe can first call `indexedDB.databases()` and require an existing `doca-ai-pending` database at version 1. Only then open it at version 1, use an `entries` **readonly** transaction and query the `scope` index with `[config.origin, config.userId, config.connectionId]`. Verify its profile and message ID rather than reading only a total count. Do not open an absent database as a “probe,” create stores, edit records or copy real account payloads into reports. Current helpers in `ai-pending-store.ts` and async scoped adapters in `ai-pending-delivery.ts` are the implementation interface; the old sync localStorage helpers are not the active sender.

## Verification scope

- Two real Chrome pages, with no Web Locks needed for writes: 200 concurrent inserts, concurrent draft bind/withdraw/accept and 100 further inserts yield **299 pending entries plus two retained tombstones**, with exact ID sets and immediate peer reads after commit. Unknown versions/records and unavailable/blocked/quota/abort cases preserve original data. The parked network operation did not block a different session's transaction. See transaction evidence（本地产物：`ai-pending-idb-concurrency/results.json`）.
- Actual shared AIChat: three early refresh windows retain the original ID and later independent draft, one message POST and one committed capture each. Accepted-reply-lost refresh performs only the readonly `pendingId` lookup, with zero new capture attempts or POSTs. See refresh evidence（本地产物：`ai-pending-refresh/results.json`）.
- Actual shared AIChat storage failure: unavailable, blocked, transaction abort and quota preserve text and legacy raw values, show feedback and create zero model jobs/captures/POSTs for these ready/text fixtures. See failure evidence（本地产物：`ai-pending-storage-failure/results.json`）.
- Actual legacy UI: explicitly selecting missing model/scope continues the original ID once; accepted old items only reconcile; withdrawal writes its final tombstone directly. Original bytes and later drafts survive reload, without revived old items. See legacy evidence（本地产物：`ai-pending-legacy/results.json`）.

The final ordinary website history run also passes all five cases, including collapse during session creation/upload, one upload/message submission, image visibility and reload. See the final website receipt（本地产物：`ai-history-idb/browser.json`）.

All of these use fresh synthetic accounts/databases, mocked model execution and zero paid provider calls. They do not retry or modify the real HTTP504 image task, whose usage remains unknown. Final full workspace and packaged MV3 receipts are recorded separately by the coordinating run.

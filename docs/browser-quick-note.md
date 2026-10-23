# Browser quick notes

The extension appends a plain-text note to an existing rich-text or Markdown document without an AI request. It does not replace content, create a new document, import HTML, add a source heading, or change a collection profile. The selected target and send ticket remain in memory only while the extension view is open.

The target list contains only the exact `targetId` of a current enabled **append** collection profile. Each entry must still pass the existing collection capability checks (`documents.create` and `documents.import`), document edit authorization and knowledge-book restrictions. A create profile's library or parent is not an existing-document edit grant. No generic document endpoint is exposed through the extension bearer token.

## Current API

All endpoints use the existing `Bearer doca_browser_v2_…` credential and browser-clipper origin policy. No website cookie is required in the extension request. A live matching website sign-in is still required by that credential. The assistant switch and AI model configuration are not needed.

`GET /api/v1/browser-clipper/quick-note/targets` returns:

```json
{
  "items": [{
    "profileId": "UUID",
    "profileRevision": 1,
    "profileName": "Notes",
    "isDefault": true,
    "targetId": "UUID",
    "title": "Existing document",
    "format": "rich_text"
  }]
}
```

The extension keeps an explicit target selection in memory and submits:

```text
POST /api/v1/browser-clipper/quick-note/prepare
{ requestId: UUID, profileId: UUID, profileRevision: positive integer, text: string }
```

Text must contain a non-whitespace character and be at most 64 KiB in UTF-8. Additional fields, including a caller-supplied target ID, HTML content, native update or assets, are rejected. Preparation returns `{ requestId, ticket, targetId, format, expiresAt }`; the ticket is 64 hexadecimal characters and expires after five minutes. Preparation of an already opened document does not write a content update. A document never opened before uses its existing native editor initialization handshake; no old format reader or baseline conversion is added.

```text
POST /api/v1/browser-clipper/quick-note/commit
{ requestId: UUID, ticket: hex64 }
```

Success returns `{ requestId, targetId, url, seq, epochId, changed }`. An original accepted increment replay returns its current native acknowledgement with `changed: false`; it does not append again. Keep the original input until this response is acknowledged. Later edits to the composer must not be cleared by an earlier acknowledgement.

The server builds the native increment once and keeps its original message ID and bytes with the ticket. Repeated simultaneous preparation of the same request and text returns one ticket. Changing text or profile while reusing that request ID is a conflict. After an uncertain commit response, retry only the same `requestId` and ticket. Do not automatically create a new preparation or ID. Accepted IDs cannot be regenerated after their ticket is lost or expires.

## Authorization, content and failures

Prepare and commit acquire the existing user transaction lock and then reauthenticate the actual token, live connection and website session. They recheck profile ownership, enabled status and exact revision, target format and current resource/capability permissions. A ticket is bound to that user, connection and sign-in token. A changed profile never retargets an in-flight note. A token rotation, logout, revoked document permission or native epoch mismatch stops the old send.

Rich text appends native paragraphs whose leaves contain only the supplied text; line breaks become paragraph boundaries. Markdown appends the supplied string to the existing native text root, separated from nonempty existing content by two newlines. It remains ordinary Markdown source text; Markdown rendering follows the document editor's current behavior. Neither path parses user HTML or invokes an AI/import conversion service. Existing document checkpoints, epochs, assets, comments and preceding content remain native.

Tickets are bounded process memory, not a persistent draft or new receipt format. A server restart, expired ticket or request routed to another server process can return `quick_note_ticket_missing`. Preserve the input and show an uncertain/error state with the document link; do not automatically prepare or append it again. A deployment with multiple server processes needs request affinity for this short prepare/commit flow. This flow provides no automatic cross-process ticket recovery.

Other errors include `quick_note_request_conflict`, `quick_note_request_already_used`, `quick_note_signin_changed`, `quick_note_busy`, the existing `clipper_profile_changed` and existing authorization/protocol errors. All preserve the input. Capacity refusal does not evict another live ticket. Foreign connection tickets and extra commit fields are rejected. No target selection, text, ticket or compatibility marker is written to extension/browser storage by this host flow.

Successful writes use the existing format-specific native receipt table (`editor_receipts` or `markdown_receipts`) and the existing document change notification. No DDL, receipt kind, grant field, stored payload format, compatibility reader or migration is introduced. Rolling back the feature removes its routes and discards ephemeral tickets; successful document edits and existing native receipts remain ordinary document history.

Implementation and focused/synthetic browser results are recorded in [the quick-note verification](verification/issue-tracker-2026-10-21/browser-quick-note.md).

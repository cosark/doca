# Sheet 0.2.2 integration

Doca 0.1.25 pins the published npm artifact. The [package audit](package-audit.json) records registry integrity and SHA-256 hashes. Public types, dependency contracts and Yjs/model/XLSX runtime bytes match 0.2.1; some source maps differ. Stable host sessions, resources, schema 6, baselines, epochs and durable ACK/outbox are unchanged.

- Typecheck and production build passed.
- Full host suite: 280 files / 2857 tests passed; 2 files / 7 tests skipped.
- Upstream native unlink and capability suite: 6 tests passed, covering mixed text/style/node preservation, readonly denial, undo/redo, peer replay and checkpoint recovery.
- [Host hyperlink browser checks](browser.json): 8 passed, including Cancel/Close/Escape/outside dismissal with zero writes, confirmation with durable save, undo/redo, reload and readonly/selection/resize/60-second idle without writes.
- [Host editor interaction recheck](editor-interactions.json): 29 passed on Sheet 0.2.2, including mentions, keyboard handling, actual peer rendering, comment controls and 60-second idle without writes. The earlier three-round 0.2.1 record retains its original version and scope.

All data came from synthetic accounts, isolated in-memory databases and temporary file stores. The [readonly screenshot](sheet-readonly.png) was inspected. Remote Redis and native-device acceptance were not run; these checks do not establish every spreadsheet operation. Rollback retains the 0.2.1 artifact and previous lockfile; the patch adds no migration or compatibility adapter.

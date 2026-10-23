# Verification records

Reviewed verification summaries and documentation attachments are committed here, grouped by acceptance case or release. Keep the original dates, results and scope. Existing committed release evidence and attachments remain available to the documentation that cites them.

Scripts write generated logs, screenshots, JSON reports and exports to `artifacts/verification/<case>/`, which is entirely ignored by Git. Reusable test inputs belong in `tests/fixtures/`; application icons, documentation images, package manifests and other source configuration stay in their source directories. New local output requires no ignore-rule changes.

The untracked raw attachments and seven temporary diagnostic or intermediate-run READMEs from `issue-tracker-2026-10-21/` now live under `artifacts/verification/issue-tracker-2026-10-21/`. Raw attachment bytes are preserved. Long-term summaries and contracts remain here; references marked “本地产物”, “本地图片” or “本地记录” describe ignored local files and are not repository links. Historical results and source fingerprints describe their original runs, not a rerun after this path cleanup. Deliberately selected attachments required by published documentation may still be committed alongside their referring documentation. Required dependency patches and reusable test scripts remain tracked source inputs.

- [PostgreSQL attachments and sending](ai-postgres-send-regression-2026-10-10/README.md)
- [Released database schema startup](book-schema-startup-2026-10-13/verification.json)
- [Credential browser acceptance](../plugin-credential-acceptance.md)
- [Sheet 0.2.2 integration](sheet-package-upgrade-2026-10-15/README.md)
- [Editor package upgrade](editor-package-upgrade-2026-10-14/report.json)
- [Knowledge-book preview stability](knowledge-book-reliability-2026-10-12/preview-result.json) and [storage measurements](knowledge-book-reliability-2026-10-12/storage-size.json)
- [Knowledge-book storage verification](knowledge-book-storage-plan-2026-10-12/verification.json)
- [Release 0.1.25 verification](release-0.1.25/README.md)
- [Storage browser acceptance](../storage-browser-acceptance.md)

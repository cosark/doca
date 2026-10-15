# Shared plugin database verification — 2026-10-15

All fixtures use synthetic users/documents, temporary directories and dedicated PostgreSQL containers. No deployment database or user document is used.

- Current target: one shared plugin business store, host format 3; core DDL/generation unchanged.
- Approved old-data policy: normal uninstall on released 0.1.25, then reinstall; private plugin data is discarded without migration. Core rows and ordinary user files remain.
- Actual released source: `smartdoca/doca:0.1.25`, multi-platform manifest `sha256:c91829a19e3bc1cccd41f6d81d452c582047990ea4437eaac534fae4d1928ba4`.
- `scripts/verify-plugin-database-isolation-upgrade.ts`: released image creates retained users/resources/document states/grants/settings/user folders plus plugin business rows, credentials and private objects. New startup rejects the active old declaration; the old image checks retained rows/declaration are unchanged. Normal old-host uninstall clears private business tables, credentials and objects. Current code reopens the same core, checks retained rows and reinstalls into an empty shared store.
- `tests/plugin-databases.test.ts`: shared SQLite file and restart, shared PostgreSQL pool with one connection, repeated scope switching, missing file/schema rejection, obsolete/redacted configuration and core/unknown-target protection.
- `tests/plugin-managed-storage.test.ts`: same logical names across plugins, isolated data and uninstall, structural validation, once-only callbacks, rollback, stale generation rejection, simultaneous initialization and durable cleanup retries.

Final command summaries and retained non-sensitive output are recorded alongside this document. This evidence does not establish a production deployment or support for mixed-version hosts. Public SDK source/exports are unchanged; no npm package is republished.

Validation results:

- Full default suite: 2,861 passed, 8 environment-conditional skipped; 280 files passed and 2 skipped.
- TypeScript check and production Web build passed.
- Documentation build/check passed: 67 pages in both languages, including link/heading validation.

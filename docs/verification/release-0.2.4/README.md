# Doca 0.2.4 verification

Release verification is in progress. Runtime changes, book presentation changes and the approved checkpoint contract are documented in the [release notes](../../releases/0.2.4.md). All tests use isolated databases, synthetic accounts and disposable container volumes; no production site is upgraded by this verification.

The [checkpoint record](../knowledge-book-checkpoints-2026-10-19/README.md) already covers SQLite, PostgreSQL 17/18, actual released 0.2.3 data and cold-process recovery. Final production-build, full-suite and multi-architecture image results will be recorded here before publication.

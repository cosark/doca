# Knowledge-book checkpoint verification — 2026-10-19

Implementation is local and uncommitted; no online database or production run was inspected or modified. All accounts, sources, publications and failure scenarios here are synthetic and isolated. No paid model calls were made for these checkpoint tests. See [results.json](results.json), [source hashes](source-hashes.json), and the [approved contract](../../knowledge-book-generation-performance.md).

## Regression matrix

| Engine | Command scope | Result |
| --- | --- | --- |
| SQLite | checkpoint store/runtime, original model runtime, batching, payload storage, book engine, reconciliation and current schema (8 files) | 211 passed |
| PostgreSQL 17.11 | checkpoint store/runtime, payload storage, book engine and PostgreSQL reconciliation (5 files) | 98 passed |
| PostgreSQL 18.6 | same five files | 98 passed |
| TypeScript | `pnpm typecheck` | passed |

SQLite command:

```sh
pnpm exec vitest run tests/knowledge-book-batch-checkpoints.test.ts tests/knowledge-book-checkpoint-runtime.test.ts tests/knowledge-book-runtime.test.ts tests/knowledge-book-payload-storage.test.ts tests/knowledge-books.test.ts tests/schema-reconciliation.test.ts tests/database-schema.test.ts tests/knowledge-book-batching.test.ts
```

For each disposable PostgreSQL 17/18 server, set `DOCA_TEST_POSTGRES` to that isolated server and run:

```sh
pnpm exec vitest run tests/knowledge-book-batch-checkpoints.test.ts tests/knowledge-book-checkpoint-runtime.test.ts tests/knowledge-book-payload-storage.test.ts tests/knowledge-books.test.ts tests/schema-reconciliation-postgres.test.ts
```

The fixture helper creates a fresh isolated schema per test and removes it afterwards. Do not point these tests at user databases.

Coverage includes immutable duplicate installation, competing model plans, cancellation/lease/permission loss during generation and upload, strict unknown-version and missing-object rejection, negative-verdict reuse, exact source inventory without source text, no cross-run copy, separate repaired content scopes, GC pins, trash retention, permanent deletion, operational switch validation, storage rollback refusal and schema loss/review rejection without partial writes.

The six runtime integration cases reject model changes during a request and restore negative assertion diagnostics, a subdivision decision with both children, a long-form outline/assignment/writing plan, and a complete failed pipeline. In the pipeline, the second of two writing batches fails; replacing the runtime and explicitly resuming changes total writing calls from 2 to 3. The first completed batch and both extraction requests are reused; all 42 claims survive acceptance and publication. Vendor streams are deterministic mocks, while engine, database and object codec are real.

## Actual released 0.2.3 upgrade

Released image: `smartdoca/doca:0.2.3`, digest `sha256:187ec89bbe1e0a02de33693c881c89f4c030ca7a49dc4a6a0549a6c40f1691cb`. Its own released TypeScript creates the fixture, with an assertion that the checkpoint table does not exist. The fixture includes source/configuration rows and native node, run and release objects; its published pointer is installed synthetically to test storage preservation, not model quality.

The [roundtrip script](released-roundtrip.mjs) uses the same seed/verify interface. Seed inside the old image with `DOCA_CHECKPOINT_MODE=seed`, `DOCA_CHECKPOINT_APP_ROOT=/app` and `DOCA_CHECKPOINT_FIXTURE_ROOT=/qa`, mounting a fresh private fixture directory at `/qa`. For PostgreSQL, set `DOCA_CHECKPOINT_DATABASE_URL` to a fresh disposable database. Verify from this checkout with its absolute app root and the retained fixture directory. No password or database dump is committed here.

```sh
DOCA_CHECKPOINT_APP_ROOT="$PWD" DOCA_CHECKPOINT_FIXTURE_ROOT=/absolute/isolated-fixture node --import tsx docs/verification/knowledge-book-checkpoints-2026-10-19/released-roundtrip.mjs
```

On SQLite and PostgreSQL 17/18, initial upgrade and repeated/concurrent independent-process starts pass. All 13 preexisting table record hashes, native body SHA-256 values, publication pointers and the compatibility generation remain unchanged. The new table is empty. [Final repeated/concurrent results](released-final-results.json) contain two independent-process confirmations for each engine. Review-required and lost-footprint cases are separately tested in the matrix above. This establishes upgrade from the tested release/generation, not every historical schema or old SQL artifact readability.

## SIGKILL and cold storage

The [crash script](crash-roundtrip.mjs) uses SQLite and the real private local host file store. Run `save` and `resume` as separate Node processes with the same fresh private root:

```sh
DOCA_CHECKPOINT_CRASH_ROOT=/absolute/fresh-isolated-root DOCA_CHECKPOINT_CRASH_MODE=save node --import tsx docs/verification/knowledge-book-checkpoints-2026-10-19/crash-roundtrip.mjs
DOCA_CHECKPOINT_CRASH_ROOT=/absolute/fresh-isolated-root DOCA_CHECKPOINT_CRASH_MODE=resume node --import tsx docs/verification/knowledge-book-checkpoints-2026-10-19/crash-roundtrip.mjs
```

The first process commits one complete request then intentionally exits by SIGKILL (137). The fresh process changes the lease, rereads current source permissions, restores the original batch with zero producer calls, produces only the missing batch once, and confirms both objects remain pinned under GC. This was rerun after the final inventory-only format change. It verifies persistence and process recovery, not a provider outage or production performance target.

## Application preview and limits

The real full application is running at `http://127.0.0.1:39273/#/knowledge-books` against the retained private QA database with six existing test books. Its complete navigation is present. The SQLite database was backed up before restarting the updated backend; no model generation was requested during startup. The main configured historical database was not upgraded or reset.

The original eight-hour production run and its stage timings were unavailable. These tests validate request reuse, preservation and required quality behavior; they do not claim an eight-hour-to-specific-duration improvement or a fresh paid 150,000-character acceptance run. No production build, deployment or rollback was performed.

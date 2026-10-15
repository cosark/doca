# Database upgrade contract

[简体中文](database-schema-evolution.zh-CN.md)

This is Doca's project-wide contract for future core database changes. Development and review must follow it; it is not limited to the shared-folder release. Read it before changing tables, fields, indexes, constraints, initialization or persisted data formats. [AGENTS.md](../AGENTS.md) requires the concrete compatibility plan to be agreed before implementation, including the meaning of historical defaults, data preservation, validation and recovery. The reconciliation mechanism below is already agreed; each new business compatibility decision still needs its own agreement.

## One current target structure

The latest DDL in `packages/db/src/create-schema.ts` and its structure helpers is the only target structure. Fresh creation and upgrade inspection use `createCurrentStructure`; there is no sequence of per-release SQL migrations for ordinary additive changes.

Keep the corresponding Kysely types in `packages/db/src/schema.ts` consistent with this DDL. `schemaEvolution` is the allowlist of reviewed table/column additions within the supported compatibility generation, not a collection of historical SQL scripts. Adding a declaration does not make a type change or a data conversion safe. Do not remove declarations needed by a still-supported old structure without agreeing on the resulting support change.

`schema_baseline.id` identifies a compatibility generation, not every release. The current generation is `doca-2026-10-12-book-payload-storage-v1`. The approved [knowledge-book schema alignment](knowledge-book-payload-storage-plan.md) lets 0.1.24 startup align released `doca-2026-10-09-history-storage-v1` databases through the ordinary current-DDL reconciler, then record the target generation in the same transaction. All existing business rows, including old SQL book outcomes and publication pointers, remain untouched. There is no automatic body conversion, cleanup or legacy runtime reader; leftover old outcomes require manual handling. The generation records the installed target structure and does not establish readability of old JSON. Existing optional offline byte-exact maintenance remains available before startup when those outcomes must be preserved in the native object format. Existing explicit history and interrupted-conversion gates remain.

The goal is to upgrade directly from a supported older structure to the current target without replaying intervening release scripts. A matching generation alone is insufficient: structural and semantic differences must also meet the agreed policy. This does not promise upgrades from every historical or manually modified database. A major incompatible change may introduce a new generation only after agreement on rejection, any explicit conversion, preservation and recovery.

## Startup reconciliation

Startup acquires a database/schema lock and compares the installed structure with a reference built from current DDL. Inspection covers columns, types, defaults, primary/foreign/unique/check constraints and indexes. PostgreSQL uses session-local temporary reference tables; SQLite uses a separate in-memory database. Neither reference uses user documents.

Column nullability is checked through `pg_attribute.attnotnull` on PostgreSQL. PostgreSQL 18 additionally records table-column `NOT NULL` constraints in `pg_constraint`; these duplicate entries are excluded from the table-constraint comparison. This allows approved required-column additions without treating their new `NOT NULL` entries as unrelated constraint changes. Existing column nullability changes still require review. See the PostgreSQL [18](https://www.postgresql.org/docs/18/catalog-pg-constraint.html) and [17](https://www.postgresql.org/docs/17/catalog-pg-constraint.html) catalogs.

`schemaEvolution` declares reviewed new tables and fields. Nullable additions and required fields with literal historical defaults can be added automatically when explicitly declared. New ordinary indexes can also be created. A default expresses a historical business decision; it must never be invented by the reconciler. Required fields without such defaults, type/default/constraint changes, unique-index validation, removals and unknown tables produce a concrete `SchemaReviewRequired` plan before any persistent change is applied. There is no automatic deletion or reset.

| Difference | Startup behavior |
| --- | --- |
| Empty database | Create the current structure and initial system rows. |
| Reviewed missing table | Create the table and its declared indexes; no historical backfill is inferred. |
| Reviewed nullable column, or required column with an approved literal default | Add the column; existing rows receive the agreed historical value. |
| Missing ordinary non-unique index on an existing table | Create the index and recheck the structure. |
| Existing type, default, nullability, primary/foreign/unique/check constraint or index definition differs | Report a review plan and stop before persistent changes. |
| Required column has no approved historical value; new unique index on an existing table; rename or removal; unknown table; persisted business semantics change | Require a separately approved preservation/conversion plan; do not silently apply a destructive or semantic upgrade. |

For existing rows, explain what a new field means and how its value preserves prior business behavior. New-record defaults and historical-row defaults can differ. Permission, sharing, credential and resource restrictions must not be silently released by filling an older row with a convenient value. A rename must be reviewed as data preservation, not disguised as dropping and recreating a field.

Structural comparison cannot detect a changed JSON format or business meaning when the SQL structure stays identical. Developers must still review those compatibility decisions and implement the agreed validation/conversion or generation gate. A clean structural comparison is not evidence of semantic compatibility.

The latest installed table/column footprint replaces `schema_baseline.structure_json` after successful reconciliation. A previously installed table or field going missing is reported as possible data loss, even if its original introduction was automatic. Plugin business tables now live in [independent plugin databases](plugin-database-isolation.md). Remaining old `plugin_<56 hex characters>` tables are review-required unknown tables: startup preserves them and stops before structural changes. Complete normal uninstall on the previous host before upgrading; there is no automatic deletion or data migration. Plugin business data versions still use their own public storage contract.

All accepted changes and footprint recording are transactional and rechecked before commit. A failed operation rolls back the whole attempt. Repeating startup preserves data and configured values. Review-required differences need a separately approved data-preservation/conversion plan; startup does not offer a destructive bypass.

The whole plan is classified before any persistent DDL is applied. If one difference requires review, none of the otherwise automatic changes are applied in that attempt. PostgreSQL takes fresh catalog reads after obtaining the schema lock so concurrent hosts see the preceding committed upgrade. An invalid recorded footprint also stops startup.

## Required development and release workflow

1. Identify affected old versions, schema generation, code paths, stored rows and persisted formats. Explain which differences are retained, added, rejected or explicitly converted, including historical values, validation and recovery; obtain agreement under the repository compatibility rule.
2. Update the latest DDL and matching types. Declare only approved supported additions in `schemaEvolution`. Route semantic conversion through its separately approved mechanism; ordinary upgrades must continue to use the shared target and reconciler.
3. Add or adjust isolated regression fixtures for affected old structures containing representative existing rows. Verify retained values, new defaults, empty new tables where applicable, repeated/concurrent startup, and unchanged data/structure when review or validation prevents upgrading. Check that previously installed fields cannot be recreated silently after loss.
4. Run SQLite reconciliation regression and the PostgreSQL 17/18 matrix. `.github/workflows/database-upgrade.yml` runs the PostgreSQL schema and folder cases; new business changes must add their own relevant cases. A SQLite pass alone does not establish PostgreSQL compatibility, and reversing the latest schema alone does not establish an actual released-version upgrade.
5. Before release, create an isolated old database using the affected released version and upgrade it with the release candidate. Check retained business data and the affected feature after upgrade and restart. Record the tested versions, database engines and material limits in release verification and upgrade notes.

Use synthetic accounts and isolated test databases/documents. `tests/database.ts` creates and cleans an isolated PostgreSQL schema for each fixture. Never run destructive fixtures or collaboration editing checks against user data. Read the applicable collaboration/plugin contracts when a change enters those areas.

The contract and its Chinese version must stay aligned with the implementation. New automatic behavior, support changes and semantic exceptions must be agreed, implemented, documented and validated together. A document describing a future capability is not proof that the reconciler supports it.

## Example: shared-folder additions

The previously released folder link structure lacks `max_members`, `expires_at` and `revision`. Their historical values are respectively `NULL` (unlimited), `NULL` (no expiration), and `1`. Existing tokens, enabled states, roles, timestamps and folder memberships remain unchanged. New links explicitly start at one member in application code. New `file_folder_link_members` and `file_folder_invitations` tables start empty. Historical member provenance and invitation facts are not inferred or backfilled.

## Deployment and recovery

Back up the database before deploying. Update every host instance before enabling new folder sharing restrictions: older code does not enforce the new limit or consent flow, so mixed-version operation is not supported. No compatibility-generation bump or offline migration command is needed for this reviewed additive change.

Preserve the database/file volumes, deployment identity and original `DOCA_CREDENTIAL_MASTER_KEY`. A structurally compatible additive upgrade does not by itself establish safe mixed-version operation or application downgrade; assess those against the affected business behavior.

For a failed startup upgrade, the transaction retains the original structure and data. After a successful deployment, returning to old application behavior needs a separately reviewed recovery plan: restoring a pre-upgrade backup also loses later writes, and old hosts cannot enforce new restrictions. Preserve any new records before such a rollback. Do not delete the database to resolve a review-required difference.

Verification uses isolated SQLite files and PostgreSQL 17/18 schemas: prior structure with existing rows, empty new tables, nullable and required/defaulted fields, repeated/concurrent startup, changed defaults/nullability, preserved plugin data, and rejection of lost installed fields. Release 0.1.22 also starts the actual 0.1.20 image against PostgreSQL 18 before upgrading with the new image. Folder tests cover notifications/tickets, consent, live permissions, expiration and concurrent link admission.

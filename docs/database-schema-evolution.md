# Database structure evolution

The latest DDL in `packages/db/src/create-schema.ts` and its structure helpers is the only target structure. Fresh creation and upgrade inspection use `createCurrentStructure`; there is no sequence of per-release SQL migrations for ordinary additive changes.

`schema_baseline.id` identifies a compatibility generation, not every release. The current generation remains `doca-2026-10-09-history-storage-v1`. The existing explicit history upgrade and interrupted-rollback gates remain in place because they change persisted history semantics.

## Startup reconciliation

Startup acquires a database/schema lock and compares the installed structure with a reference built from current DDL. Inspection covers columns, types, defaults, primary/foreign/unique/check constraints and indexes. PostgreSQL uses session-local temporary reference tables; SQLite uses a separate in-memory database. Neither reference uses user documents.

Column nullability is checked through `pg_attribute.attnotnull` on PostgreSQL. PostgreSQL 18 additionally records table-column `NOT NULL` constraints in `pg_constraint`; these duplicate entries are excluded from the table-constraint comparison. This allows approved required-column additions without treating their new `NOT NULL` entries as unrelated constraint changes. Existing column nullability changes still require review. See the PostgreSQL [18](https://www.postgresql.org/docs/18/catalog-pg-constraint.html) and [17](https://www.postgresql.org/docs/17/catalog-pg-constraint.html) catalogs.

`schemaEvolution` declares reviewed new tables and fields. Nullable additions and required fields with literal historical defaults can be added automatically when explicitly declared. New ordinary indexes can also be created. A default expresses a historical business decision; it must never be invented by the reconciler. Required fields without such defaults, type/default/constraint changes, unique-index validation, removals and unknown tables produce a concrete `SchemaReviewRequired` plan before any persistent change is applied. There is no automatic deletion or reset.

The latest installed table/column footprint replaces `schema_baseline.structure_json` after successful reconciliation. A previously installed table or field going missing is reported as possible data loss, even if its original introduction was automatic. Host-managed plugin tables are identified by the host's reserved `plugin_<56 hex characters>` naming contract and remain outside core reconciliation. Plugin business data versions still use their own public storage contract.

All accepted changes and footprint recording are transactional and rechecked before commit. A failed operation rolls back the whole attempt. Repeating startup preserves data and configured values. Review-required differences need a separately approved data-preservation/conversion plan; startup does not offer a destructive bypass.

## Shared-folder change

The previously released folder link structure lacks `max_members`, `expires_at` and `revision`. Their historical values are respectively `NULL` (unlimited), `NULL` (no expiration), and `1`. Existing tokens, enabled states, roles, timestamps and folder memberships remain unchanged. New links explicitly start at one member in application code. New `file_folder_link_members` and `file_folder_invitations` tables start empty. Historical member provenance and invitation facts are not inferred or backfilled.

## Deployment and recovery

Back up the database before deploying. Update every host instance before enabling new folder sharing restrictions: older code does not enforce the new limit or consent flow, so mixed-version operation is not supported. No compatibility-generation bump or offline migration command is needed for this reviewed additive change.

For a failed startup upgrade, the transaction retains the original structure and data. After a successful deployment, returning to old application behavior needs a separately reviewed recovery plan: restoring a pre-upgrade backup also loses later writes, and old hosts cannot enforce new restrictions. Preserve any new records before such a rollback. Do not delete the database to resolve a review-required difference.

Verification uses isolated SQLite files and PostgreSQL 17/18 schemas: prior structure with existing rows, empty new tables, nullable and required/defaulted fields, repeated/concurrent startup, changed defaults/nullability, preserved plugin data, and rejection of lost installed fields. Release 0.1.22 also starts the actual 0.1.20 image against PostgreSQL 18 before upgrading with the new image. Folder tests cover notifications/tickets, consent, live permissions, expiration and concurrent link admission.

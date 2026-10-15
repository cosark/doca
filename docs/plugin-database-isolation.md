# Independent plugin databases

[简体中文](plugin-database-isolation.zh-CN.md)

Working-tree implementation, 2026-10-14; not a published release or production deployment. The owner approved discarding existing plugin business data through normal uninstall, with no migration. The verified upgrade source is the released 0.1.24 image; older core compatibility-generation gates still apply.

## Ownership and configuration

The host manages each plugin's business database. Plugins keep the unchanged `storage.sql.v1` SDK, schema version 1 and `dataVersion`; they receive no connection strings, drivers or filesystem paths. Business tables use their declared logical names. `_doca_plugin_store` binds the database to the exact plugin ID, installation generation, data version and canonical schema.

The core database retains users, documents, permissions, security audit, raw AI usage, plugin registry/archive references, namespace records, encrypted credentials, private-object references and durable object garbage intents. Files and credential services retain their current ownership and permissions. `schema_baseline.id` and core target DDL do not change.

SQLite uses one file per plugin, under `<core-database-path>.plugins/` by default. `DOCA_PLUGIN_DATABASE_DIR` optionally overrides that directory. Files are named by the SHA256 of the plugin ID, with mode 0600; business tables inside remain readable. Keep this directory on the persistent local volume and include it in backups. SQLite is for a single host, not network filesystem sharing. In-memory embedding uses separate in-memory plugin databases.

PostgreSQL requires operator-provisioned independent databases and restricted login roles. The host does not use the core account to create roles/databases or fall back to core storage. Configure SQL-using plugins before enabling them:

```dotenv
DOCA_PLUGIN_DATABASES_JSON='{"version":1,"databases":{"example.mail":{"url":"postgresql://doca_mail:replace-me@postgres:5432/doca_mail","poolMax":2}}}'
```

Each entry has an explicit pool limit. Budget the sum of plugin pools, core/AI/webhook pools and instance count against the server limit. Duplicate configured targets, the core database, elevated roles, role memberships and core-table privileges are rejected. Use separate roles with grants only for their own business databases; also revoke unwanted PUBLIC connection/schema privileges. The host checks physical database identity and core-table access on a shared endpoint. Connection configuration and credentials are never exported to plugins. Process/container isolation remains outside this change: plugins still execute in a trusted host process.

Changing a database URL or directory does not migrate data. A configured empty replacement is rejected once the installation has a recorded schema; retain the original configuration or explicitly uninstall/reinstall.

## Install, declare and uninstall

New namespace declarations have host storage format 2 (`storageVersion: 2`, `schema: null` initially). Active old-format installations are rejected, including stateless installations with null definitions. Core reconciliation reports remaining old `plugin_<56 hex>` tables before persistent structural changes. There are no old readers, automatic table deletion, schema conversion or dual writes. Historical already-removed namespace rows remain as installation history; explicit reinstall increments their generation and records the new declaration.

First schema declaration locks the core namespace, creates the business tables and installation marker in one business transaction, then records the exact schema in the core transaction. If business creation committed but the core transaction did not, a retry accepts only the same canonical marker, generation and schema and verifies the actual structure. It never adopts an old installation or an unrelated database. Missing tables/files and changed types, defaults, nullability, primary/unique constraints or extra tables are rejected rather than recreated. User transaction callbacks execute once, with expired handles after completion; a business commit followed by core-commit failure is an uncertain outcome and must be resolved through business idempotency/readback, not automatic callback replay.

Business transactions hold the core namespace lock until their business commit finishes, so uninstall cannot fence a generation while an admitted write is still committing. The business uninstall hook runs first. On hook success, the core registry transaction marks the namespace removed, clears installation selection and credentials, and queues private-object cleanup. User files, permissions, receipts and release archives are retained. Hook failure retains the installation; external hook effects are not rolled back.

Business DDL cleanup occurs after that core commit. The retained namespace declaration is its durable intent. Startup, the periodic cleanup task, uninstall and installation attempts retry it. Cleanup locks and rechecks the removed generation, verifies its business marker, and drops only declared tables and the marker. Unknown tables or a mismatched marker cause cleanup to fail without partial deletion. A committed business cleanup followed by an interrupted core intent update is safely retryable. An interrupted initial declaration can also be cleaned through its exact business marker. Reinstall waits for completed cleanup, increments the generation and creates an empty schema. Old handles cannot access the new generation. No distributed atomic commit or automatic cluster task draining is promised; every instance still needs a restart.

## Approved upgrade and recovery

1. Back up the original core database, file storage and deployment configuration, including the credential master key.
2. While the previous host is still running, normally uninstall all external business plugins. This deliberately deletes their private business rows, encrypted credentials and private objects. Account bindings and plugin configuration must be recreated. Do not manually drop tables before uninstall.
3. Stop every host instance. Provision/configure PostgreSQL plugin databases if needed. Deploy this implementation with the existing core database, ordinary user files and master key.
4. Reinstall plugins and restart every instance. Their SDK business models are rebuilt in empty independent databases; no previous business data is imported.

If step 2 fails, remain on the previous host and resolve its uninstall failure. If the new startup rejects residual installations or tables, return to the previous host to complete uninstall; do not reset the core database. Before new writes, recovery to the pre-uninstall state requires the matching original database/file backup and old deployment. Uninstalled external authorizations may need rebinding. After new writes, reverting application code or restoring old backups can discard later data; preserve the new databases and obtain a separate recovery decision. The old host cannot read the new plugin database layout.

## Verification

Isolated SQLite and PostgreSQL 17/18 tests cover physical separation, restricted roles, repeated initialization, independent connections, callback rollback, stale generations, missing stores, unchanged core data on old-table rejection, interrupted declarations and retryable uninstall cleanup. The released 0.1.24 image creates retained core records and old plugin rows, performs normal uninstall, then the working tree reopens the same core database and reinstalls into an empty independent business database. See `scripts/verify-plugin-database-isolation-upgrade.ts` and the verification record in the pending release notes. These checks do not establish production rollout or a mixed-version deployment.

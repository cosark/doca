# Doca development conventions

## Generated verification artifacts

Write generated screenshots, JSON reports, exports and execution logs under
`artifacts/` (verification scripts use `artifacts/verification/<case>/`). This
directory is ignored by Git. Keep reusable test inputs in `tests/fixtures/`,
source assets and configuration in their source directories, and reviewed
verification summaries in `docs/verification/`. Only commit documentation
attachments deliberately needed by published documentation; do not add raw
execution output there. Temporary diagnostic notes, per-run READMEs and
intermediate acceptance baselines also belong under `artifacts/`, even when
written in Markdown. Keep required dependency patches and reusable test scripts
in Git. Do not ignore all JSON, image, Markdown or patch files by extension.

## Compatibility changes require prior agreement

This rule applies to all work in this repository. Before introducing, retaining
as part of a redesign, or changing any forward/backward compatibility behavior,
first present the concrete proposal to the user and obtain explicit agreement.
This includes old/new API or SDK adapters, legacy configuration readers,
missing-field fallbacks for old formats, dual reads/writes, database schema or
persisted JSON compatibility, migrations, and automatic conversion of old data.
A general request to implement a feature does not authorize a compatibility plan.

Read-only investigation may proceed. Before implementation, identify the affected
versions, code paths and stored data; explain whether to reject, retain, convert,
or migrate each old format, along with data preservation, validation and rollback.
Do not silently select an old rule, invent default values for an older protocol,
or preserve an obsolete database shape just to avoid agreeing on the plan.
Do not delete or reset existing data to bypass this requirement. Report existing
compatibility code discovered during an audit; do not remove or migrate it without
an agreed plan. This repository-wide rule also applies to follow-up work and agents.

## Database structure evolution is the project standard

Before changing core tables, columns, indexes, constraints, schema initialization,
or persisted database formats, read and follow `docs/database-schema-evolution.md`
(Chinese: `docs/database-schema-evolution.zh-CN.md`). This is the agreed upgrade
mechanism for future work, not a one-release workaround. Concrete compatibility
decisions, including historical field defaults and data conversion, still require
the prior agreement described above.

- Maintain only the latest target DDL in `createCurrentStructure` and its helpers;
  fresh creation and startup reconciliation must use that same target. Do not
  introduce ordinary per-release SQL migration chains or application-version
  branches to reconstruct old schemas.
- Declare approved new tables/columns in `schemaEvolution`. Automatically apply
  only the additions supported by the reconciler, with explicitly agreed values
  for existing rows. Preserve stored data, permissions and configured values.
- Type/default/nullability/constraint changes, unique-index validation, renames,
  removals, unknown tables and semantic conversions need an approved preservation,
  validation and recovery plan. Startup must stop before persistent changes when
  any difference requires review; never delete/reset data or bypass the review.
- Keep schema inspection, accepted changes, reinspection and latest-footprint
  recording transactional under the schema lock. A lost previously installed
  field/table is possible data loss, not a new addition to recreate silently.
- Treat `schema_baseline.id` as a compatibility generation. Ordinary additions
  do not bump it; major incompatible changes and existing semantic upgrade gates
  require explicit agreement. Do not claim arbitrary-version upgrades outside
  the supported generation and reviewed structural differences.
- Validate affected old schemas with retained rows on isolated SQLite and
  PostgreSQL 17/18, including defaults, repeated/concurrent startup and rejection
  without partial writes. Release verification must also upgrade data created by
  an actual released old version. Update the upgrade contract and release notes
  when the agreed behavior or verification scope changes.

For Doca plugin loading, SDK exports, business-module extraction, AI usage policies,
or permission-directory contribution work, read `docs/plugin-sdk-contract.md`
and `docs/plugin-development.md` first. The implementation-status table distinguishes
existing exports from proposed APIs. Business plugins are discovered only through
the installation directory and consume public services, not host source paths or
global runtime bridges. Membership and content moderation belong outside the core;
authentication, authorization, security audit and original AI usage facts remain
host-owned. Do not delete persisted user data or silently release resource
restrictions during extraction.

For collaboration, editor SDK integration/upgrades, Yjs persistence, realtime selections or comment anchors, read and apply `skills/doca-collaboration/SKILL.md` and its linked contract before changing code. The same skill may be installed globally as `$doca-collaboration`.

The skill describes target invariants, not proof that a proposed API is implemented. Check the current package README/exports and compatibility before adapting. Keep `docs/collaboration-sdk-contract.md` as the source document and refresh the skill's packaged `references/contract.md` when it changes.

Do not run collaboration editing tests against user documents. Use isolated test databases/documents. Unrelated layout, calendar and visual styling tasks do not need the collaboration skill.

For editor package integration and cross-editor API work, also read `skills/doca-editor-integration/SKILL.md` and its integration reference. It distinguishes verified APIs from proposed capabilities; do not treat the target capability interface as already exported by a package.

For interface languages, locale props, or message catalogs in the host or an editor subpackage, read `skills/doca-i18n/SKILL.md`. `docs/i18n.md` is the source. The same skill may be installed globally as `$doca-i18n`. Dictionary keys are stable English identifiers.

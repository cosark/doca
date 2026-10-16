# Doca 0.1.30 release verification

This release removes program-enforced PostgreSQL account privilege checks. The deployment operator may use ordinary or administrative logins, including the same login for separate core and plugin business databases. Core/business database separation, exact format-3 declarations and plugin data versions remain enforced. No DDL, stored-data conversion, permission rewrite or SDK publication is introduced.

The release was prepared in an isolated checkout from released 0.1.29. Only the plugin database services, related tests/contracts, version references and release artifacts were selected. Unrelated uncommitted application changes in the development checkout are excluded.

## Source checks

- [Full regression](full-tests.log): 2,899 passed, 10 skipped (283 test files).
- [PostgreSQL 17](postgres17.log) and [PostgreSQL 18](postgres18.log): 58 tests each, using isolated databases and synthetic roles. Includes administrator attributes, memberships, core-table grants, same-account separate databases, restart preservation, actual grant failures and rejection of a core database target.
- [Typecheck](typecheck.log), [production Web build](web-build.log), [documentation check](docs-check.log) and [documentation build](docs-build.log) pass. Documentation contains 71 pages in each language.
- See the [diagnosis and approved account policy](../plugin-postgres-permissions-2026-10-16.md) and the [release requirements](../../releases/0.1.30.md).

## Built images

The [image smoke script](image-smoke.mjs) runs each architecture with isolated SQLite volumes and PostgreSQL databases. It verifies the release version, Host validation, gzip/Brotli assets, administrator bootstrap/login and graceful shutdown. The PostgreSQL cases install the actual `doca.resources.manage` 0.1.4 release, use one unchanged superuser login for separate core/business databases, write preferences through authenticated plugin routes and read them after restart.

The native arm64 case first creates the administrator and stages the plugin using the actual published 0.1.29 image, then opens the same databases and volume with 0.1.30. This preserves the released user's login and pending installation without conversion. The amd64 case runs under emulation on the arm64 build host. Runtime results are recorded as per-architecture JSON files beside this document; publication metadata and image digests are attached to the GitHub Release.

Run the smoke script with `node docs/verification/release-0.1.30/image-smoke.mjs <arm64|amd64> <isolated-postgres-port> <plugin-release.zip>`. It expects candidate images named `smartdoca/doca:0.1.30-<arch>-candidate` and dedicated synthetic databases named `release0130_<arch>_core` and `release0130_<arch>_business`. Its fixture-only database password is `isolated-test`; never point it at deployment databases. The script creates/removes its own temporary containers and volumes.

No user documents or deployment databases were accessed. The verification does not claim full business acceptance of every resource-plugin feature, native-device behavior or newly changed database restrictions outside this release's scope.

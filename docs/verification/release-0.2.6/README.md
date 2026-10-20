# Doca 0.2.6 verification

This release pins Compose and the current deployment instructions to `smartdoca/doca:0.2.6`, matching `package.json`. It includes the page-title, document-type column and MCP menu changes accepted in [PR #71](https://github.com/smartdoca/doca/pull/71).

Compose configuration parsing, the production Web/renderer builds, 80 bilingual documentation pages and their links/anchors pass. The image-only deployment archive passes its SHA-256 check, pins image 0.2.6 and omits the source build configuration.

The Compose diff changes only the image version and its comment. Environment settings, renderer security options, ports and the data-volume definition match the preceding configuration. Existing obsolete plugin settings are still forwarded solely for startup rejection; this release does not change that behavior. [Check summary](checks.json).

Both architecture images pass isolated in-memory database checks as UID 1000: health reports version 0.2.6, the built Web page is served, login succeeds and the authenticated navigation exposes MCP in the account menu. See [smoke results](docker-smoke.json). No production database, volume or user document is used.

The release source also passes the [PostgreSQL 17/18 GitHub matrix](https://github.com/smartdoca/doca/actions/runs/39354112633) and [documentation CI build](https://github.com/smartdoca/doca/actions/runs/39354112614).

The [arm64](runtime-arm64.json) and [amd64](runtime-amd64.json) audits each match 436 server/package/renderer files and 479 uncompressed Web files to this checkout. Editor versions and native model/Yjs artifact hashes match the installed packages. amd64 runs under emulation on the arm64 test host. [Build metadata](image-build-metadata.json) records the accepted index and runtime source revision `0bb131a10483ad979ff18919e37bd9c76492dd11`; subsequent verification records do not change runtime sources.

Docker Hub's `0.2.6` and `latest` tags independently match accepted index `sha256:3d9ee2e114ac1d5d52fdbf5f76aa7cc1758e1935742ad1dcbb0d31ffa6e44860`. Both remote Linux manifests and configuration labels identify the accepted architecture and source revision. See [remote registry verification](registry.json) and [accepted manifests](image-build.json).

The UI changes previously passed TypeScript, 64 focused navigation/i18n/title/icon tests, and browser checks for Chinese and English labels, folder navigation, AI and document tab titles, MCP navigation, refresh and 680px responsive alignment. This metadata follow-up does not repeat the entire 0.2.5 product acceptance suite.

Existing installation requirements remain documented in the [0.2.5 release notes](../../releases/0.2.5.md#upgrade-and-recovery).

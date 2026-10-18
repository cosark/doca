# Doca 0.2.2 verification

This release combines all local changes with released 0.2.1. It keeps the existing editor pins, database structure, compatibility generation, stored formats and historical readers. Verification uses synthetic accounts and isolated databases, documents, storage and container volumes.

Local typecheck, the complete test suite and both production builds pass. The suite reports 2,964 passing tests in 292 passing files, with 10 environment-dependent tests skipped across three files. The build produces the Web assets and the isolated native Canvas renderer bundle. See [test summary](tests.json).

The [built-Web browser check](browser.json) passes seven scenarios: the book/rocket tab icons, client-side document navigation, icon removal through the actual title editor, ordinary titles, refresh, returning home, and preservation of original content checkpoints. No page errors are reported. Documentation check/build passes for 75 bilingual pages. The image-only deployment archive is generated and its SHA-256 checksum verifies.

The [multi-architecture candidate](image-build.json) passes [arm64](arm64.json) and [amd64](amd64.json) process checks, including health/version, Host validation, gzip/Brotli assets, bootstrap/login, native model loading, document creation, restart and graceful shutdown as UID 1000. The actual released 0.2.1-to-0.2.2 upgrade preserves original Canvas content, the complete checkpoint row, epoch and sequence. [arm64](runtime-arm64.json) and [amd64](runtime-amd64.json) runtime audits each match 424 source/manifest/bundle files against the checkout. The arm64 manifest used for acceptance is identical to the one in the final candidate index.

The [renderer check](renderer.json) passes with Chromium's sandbox and the repository seccomp policy enabled. It generates a real PDF and native Canvas PNG, verifies selection bounds and cropped red pixels, and leaves the source unchanged. The Chinese text in the output is visually readable. The native export's system-font warning is retained in its receipt; this is not a claim of exact font fidelity.

![Native canvas renderer output](canvas-render.png)

[PostgreSQL 17/18 CI](https://github.com/smartdoca/doca/actions/runs/39134531297) and [documentation CI](https://github.com/smartdoca/doca/actions/runs/39134531368) pass on runtime-source commit `103e4941fa11461a81f10b2524cf2627be17fcda`. Final publication identifiers are recorded on the GitHub Release.

Reproduction commands, run from the repository root:

```sh
pnpm check
node --import tsx docs/verification/release-0.2.2/browser-smoke.mjs
node docs/verification/release-0.2.2/image-smoke.mjs arm64
node docs/verification/release-0.2.2/image-smoke.mjs amd64
node docs/verification/release-0.2.2/runtime-audit.mjs arm64
node docs/verification/release-0.2.2/runtime-audit.mjs amd64
node docs/verification/release-0.2.2/renderer-smoke.mjs
```

Image scripts use `smartdoca/doca:0.2.2-candidate`. Runtime audits compare the container's server/package source, root manifests and built Canvas renderer against this checkout; the unchanged npm Canvas 0.5.5 model is compared with the preceding release's package audit. The arm64 upgrade fixture starts the actual released 0.2.1 image, writes a native Canvas document, and compares original content, checkpoint row, epoch and sequence after upgrading its isolated volume. amd64 process checks run under emulation; actual sandboxed Chromium rendering is checked on arm64.

These checks do not establish every editor operation, arbitrary concurrency, native-device acceptance or complete Office layout fidelity. No production or user database is opened.

# Doca 0.2.2 verification

This release combines all local changes with released 0.2.1. It keeps the existing editor pins, database structure, compatibility generation, stored formats and historical readers. Verification uses synthetic accounts and isolated databases, documents, storage and container volumes.

Local typecheck, the complete test suite and both production builds pass. The suite reports 2,964 passing tests in 292 passing files, with 10 environment-dependent tests skipped across three files. The build produces the Web assets and the isolated native Canvas renderer bundle. See [test summary](tests.json).

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

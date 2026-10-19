# Doca 0.2.5 verification

The combined source passes [3035 tests](tests.json), with 10 environment-dependent skips and no failures. TypeScript, both production bundles, the image-only deployment archive, and documentation check/build for 79 bilingual pages pass. [Check summary](checks.json). The final lifecycle regression also verifies that deleting a closed MCP execution session preserves saved documents and host security audit facts.

Feature evidence: [MCP](../mcp-2026-10-20/README.md), [editor integration](../editor-packages-2026-10-20/README.md), [AI canvas](../ai-canvas-tools-2026-10-19/README.md).

The actual installed Codex CLI completes 42 MCP calls, creates and reads back native report/canvas/PPT/spreadsheet documents, views real canvas pixels, transfers a local file with matching SHA-256 and creates a real XLSX. An independent SDK verifies document ownership, native content, file bytes and decoded XLSX cells. Browser acceptance covers the two settings surfaces, token handling, failed-save drafts, Switch persistence and sidebar spacing at desktop/narrow/200% equivalent layouts, with three consecutive complete runs.

Both accepted architecture images pass real HTTP MCP checks as UID 1000: [arm64](arm64-mcp/image.json), [amd64](amd64-mcp/image.json). Each uses actual released `smartdoca/doca:0.2.4` to seed a separate volume, preserves 120 original table hashes during upgrade, starts the real 0.2.5 server, creates/edits/reads four native formats, renders a canvas to actual PNG, transfers 420,000 bytes with matching SHA-256, and writes a company report as a different target user. Closed execution-session deletion succeeds. A restart reads the retained original Markdown, all four new documents and a saved file range/hash. Host rejection and graceful shutdown pass. The script preserves the original deployment file-store identity and configures the public Origin to its actual loopback endpoint. All containers and volumes used by the accepted runs are removed afterward.

Runtime audits on [arm64](runtime-arm64.json) and [amd64](runtime-amd64.json) match **436** server/package/renderer source files and **479** uncompressed Web files to this checkout. Canvas 0.5.6, Sheet 0.2.4, Slate 0.4.23 and Slides 0.3.0-alpha.3 match the package manifest; native model/Yjs file hashes match installed artifacts. [Image digests and configuration IDs](image-build.json) identify the accepted filesystem. Image source revision `031707115987a120229f1888c79a684898727790` contains the final runtime code; subsequent acceptance-only changes update scripts and records. amd64 executes under emulation on the arm64 test host.

The PostgreSQL 17/18 [GitHub matrix](https://github.com/smartdoca/doca/actions/runs/39293628822) and [documentation build](https://github.com/smartdoca/doca/actions/runs/39293628746) pass. MCP-specific PostgreSQL checks pass 14 tests per engine, including session deletion and retained security facts; actual released 0.2.4 upgrade and repeated/concurrent-process checks also pass on SQLite and both PostgreSQL versions. The CI upgrade matrix now includes the MCP suites and affected file paths.

![Canvas PNG delivered through the arm64 image's MCP endpoint](arm64-mcp/mcp-canvas-view.png)

Reproduce from the release checkout:

```sh
pnpm typecheck
pnpm exec vitest run --maxWorkers=2
pnpm build
pnpm docs:check
pnpm docs:build
node scripts/pack-deployment.mjs
docker buildx build --platform linux/amd64,linux/arm64 -t smartdoca/doca:0.2.5-candidate .
DOCA_QA_ISOLATED=1 node scripts/qa-release-mcp-image.mjs arm64
DOCA_QA_ISOLATED=1 node scripts/qa-release-mcp-image.mjs amd64
node scripts/qa-release-runtime-audit.mjs arm64
node scripts/qa-release-runtime-audit.mjs amd64
```

No production site or user document is modified by these checks. Paid provider behavior is covered by the linked configured-model canvas acceptance; the MCP runs use external-client reasoning and no configured Doca language model. These results do not establish every provider, editor gesture, mobile browser or production performance characteristic. Context affinity/restart limitations and upgrade/recovery rules remain in the [release notes](../../releases/0.2.5.md).

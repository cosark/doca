# Editor integration and file exchange

[中文](editor-integration.zh-CN.md)

The current checkout integrates five editors. Use actual installed exports; target interfaces and gaps are not existing APIs. Responsibilities are detailed in the [integration reference](../skills/doca-editor-integration/references/integration.md) and [collaboration contract](collaboration-sdk-contract.md).

## Installed packages and host adapters

| Format | Installed package | Host entry |
| --- | --- | --- |
| Rich text | @smartdoca/slate 0.4.20 | document-editor.tsx |
| Markdown | @smartdoca/markdown 0.4.3 | markdown-editor.tsx |
| Spreadsheet | @smartdoca/sheet 0.2.3 | spreadsheet-editor.tsx |
| Canvas | @smartdoca/canvas 0.4.3 | canvas-editor.tsx |
| Slides | @smartdoca/slides 0.3.0-alpha.2 | presentation-editor.tsx |

Entries are in the [document feature](../apps/web/src/features/documents). Packages own models, editing commands, undo, rendering, selections, and conversion. The host owns identity, ACLs, uploads/downloads, references, user cards, navigation, comments, and collaboration transport. Locale updates chrome without translating content or rebuilding the editor.

## References, resources, and find

Internal references retain stable UUIDs and relative `#/r/{id}` locations. Mentions retain user UUIDs and obey current directory policy. Forward/reverse references recheck reading permission; references grant no access.

Images, attachments, and materials use host resource callbacks. Progress, cancel, errors, and late callbacks stay bound to the original target. Downloads authorize through `assets/:id/content?download=1`; physical storage locations are not durable references.

Rich text and spreadsheets pass stable `onAttachmentPreview` callbacks to the installed editors. Rich text supplies `AttachmentElement.path/name/mimeType`; spreadsheet native inline attachments supply `event.node.refId/label`. The host resolves asset UUIDs to permission-checked content endpoints and opens the shared `DocumentFilePreview`, also in readonly/history/trash views with their existing access flags. Rich text selects an attachment on the first edit-mode click and previews on the next click or its preview button; readonly previews on the first click. Spreadsheet previews clicks on the native attachment label. The existing whole-cell object renderer remains available. Preview does not change the model, collaboration session, or persisted format.

Find/replace uses editor models or native capabilities. Rich text uses a host Slate adapter; other formats use installed package find/replace or native panels. Readonly, disconnected, and presentation modes offer no content replacement. There is no generic public arbitrary-editor mutation handle or promise of identical text ranges/regex across formats.

## File import/export

| Format | Import | Export and limits |
| --- | --- | --- |
| Rich text | DOCX, Markdown, PDF | DOCX, Markdown, PDF; complex layout may simplify, no old DOC |
| Markdown | Markdown, converted PDF | Markdown, PDF; no complete offline asset bundle |
| Spreadsheet | XLSX | XLSX; unsupported objects may degrade with warnings, no full Office fidelity |
| Canvas | PNG/JPEG/WebP/SVG image assets | PNG/SVG; import does not restore native layers |
| Slides | PPTX, up to 30 MB | PPTX; basic text, shapes, tables, images; complex masters/animation may simplify, no old PPT |

Import creates a new document and lineage and rebinds authorized assets; it never replaces an active document. Conversion warnings are shown. PDF export uses browser/component generation and does not guarantee exact Office layout. See [file-transfer.tsx](../apps/web/src/features/documents/file-transfer.tsx) and the [file exchange contract](editor-file-exchange-contract.md).

## Comments and business extensions

Permanent anchors differ from live cursors. All five formats provide content comments. Spreadsheet uses stable row/column IDs and native capture/resolve/reveal methods; structural changes and deleted targets are validated. Unknown plugin elements retain opaque data with an unsupported placeholder, never automatic conversion or deletion.

Installed providers contribute templates, materials, and document elements, with zero default providers. Rich atomic inline and spreadsheet whole-cell elements are implemented; general blocks and floating spreadsheet objects are unavailable. See [element contract](plugin-editor-elements.md) and [creation resources](creation-resources.md).

## Verification scope

Check installed README, exports, and schema before upgrades. Use isolated documents for real file roundtrips, readonly guards, authorized assets, two-page sync, receipts, and reload. A cell-edit test does not establish convergence for every spreadsheet operation; a successful build does not establish device acceptance. Early integration/acceptance records remain in [research](research.md).

## Rich-text diagram and upload integration — 2026-10-10

The host toolbar inserts flowcharts and mind maps through the installed 0.4.13 `commands.insertBlock` API with complete native elements. It does not use `toggleBlock` to convert a paragraph into an incomplete diagram. Whole-block comments and AI references share the current block-anchor contract; native diagram labels do not gain user-mention support.

The upload adapter forwards real asset-transfer bytes to `UploadContext.onProgress` as a fraction, keeping progress below 1 until the asset service succeeds. Image, video and attachment commands keep their native placeholders, cancellation, retry and undo lifecycle.

AI diagram edits read the complete block rather than reconstructing it from outline labels. Node fill/border/text colors use `fillColor`/`color`/`textColor`; edge color/width use `color`/`thickness`. A free endpoint uses the SDK's empty source/target ID plus `sourcePoint`/`targetPoint`; an unknown nonempty ID is rejected. Updating nodes, edges or mindData invalidates the generated SVG and its derived bounds in the same native content transaction. Width-only changes retain that preview. No stored-format adapter, automatic conversion, compatibility plan or migration is introduced. Existing historical readers are unchanged.

## Published spreadsheet package integration — 2026-10-10

Host 0.1.18 locks the registry artifact `@smartdoca/sheet` 0.2.0-rc.19. The data-validation toolbar action is distinct from Insert → Dropdown list. Public declarations and Yjs/model/XLSX entrypoints are byte-identical to rc.18; the host continues using the shipped menu-extension, resource, stable-anchor and collaboration APIs. The host synchronizes the shipped `session.setReadOnly` API and refreshes the capability snapshot before painting after mode changes, without rebuilding the workbook or Y.Doc. Plugin-element insertion now uses `SPREADSHEET_MENU_PATHS.toolbarEnd` through native menu extensions. This is a UI/package integration with no codec, schema, epoch, outbox, persisted-data conversion or new compatibility behavior. Existing history readers and explicit host-baseline maintenance commands are unchanged. Package and host regressions use isolated workbooks/documents; build success alone does not establish acceptance of every spreadsheet operation.

## Published Slate and Canvas integration — 2026-10-13

Host 0.1.23 locks the registry artifacts `@smartdoca/slate` 0.4.14 and `@smartdoca/canvas` 0.4.3. Slate codec/Yjs/headless/conversion bytes and public entrypoint maps are unchanged; Canvas model/IO bytes and public entrypoint maps are unchanged. The DOCX patch is bound to the new Slate artifact. Stable host sessions, resource callbacks, permissions, presence, anchors, original checkpoints, epochs and pending update IDs keep their existing ownership. The package regenerates stale diagram previews in view state without content writes.

The user explicitly chose to make no old-flowchart compatibility promise. No host old-node adapter, automatic conversion, historical-field backfill or data deletion is introduced. New shapes, filled-arrow geometry, manual `routeMode`/`vertices` and endpoint anchors use the shipped native model; AI validation and guidance accept/preserve those fields. A previous editor may not render new fields correctly. Preserve prior deployments and the pre-upgrade backup; host database rollback separately follows the approved knowledge-book storage procedure. Existing historical readers and normalization helpers remain in their established paths and are not redesigned by this package upgrade.

Isolated host regressions cover native-field validation, durable/duplicate ACK, remote replay without echo, undo/redo, checkpoint restore, canvas engine singleton registration and DOCX roundtrips. Browser verification and final release checks are recorded in the 0.1.23 verification attachment; model tests do not establish every new diagram gesture or every canvas operation.

Canvas 0.4.3 also contains a user-approved view rule: numeric text line heights from 0.8 through 3 are displayed as font-size multipliers; other numeric values remain pixels. Loading, selection, resize and idle do not rewrite the model. Ordinary text editing preserves the original numeric field; an explicit line-height edit stores the native percentage value. No host migration, backfill or stored-data deletion is added. Browser acceptance verifies 1.5 at 32 px as 48 px, original numeric bytes after text edits, no idle writes, peer convergence and reload. Previous UI rendering is not guaranteed on rollback.

## Slate and spreadsheet package upgrade — 2026-10-14

The current checkout locks the actual registry artifacts `@smartdoca/slate` 0.4.15 and `@smartdoca/sheet` 0.2.1. Public entrypoint maps and dependencies are unchanged. Slate codec/Yjs/headless/conversion bytes are unchanged; the existing DOCX style patch is bound to 0.4.15. AI node validation accepts finite numeric `angle` values in degrees and the editing manual preserves this field. Native image interaction selects on the first click and previews on the next; clicking elsewhere resets selection.

The user explicitly approved the spreadsheet package's 18 px default row height and 72 px default column width for CRDT-added worksheets, including those created before this upgrade, and virtual empty recovery worksheets. Immutable baseline worksheets retain their original size fields, including omission; explicit per-axis sizes remain native overrides. Newly created host worksheets use the same 18/72 dimensions. This is a projection/default-display decision: existing seeds, baselines, checkpoints, epochs, comments and pending update IDs are not rewritten, converted or deleted. Schema 6 and exact protocol rejection remain unchanged. The existing virtual last-sheet recovery, history readers and normalization helpers remain in their established paths and are not redesigned.

The user retains the previously agreed absence of an old-flowchart compatibility promise. No old-node adapter or field backfill is added. New rotation uses the shipped native model; the preceding editor may ignore angles, and preceding spreadsheet builds may display different defaults. Keep the previous registry artifacts, dependency pins, patch and lockfile for package rollback, and update server and Web together. Host database rollback remains subject to its separately approved storage procedures.

Verification uses an immutable fixture generated by the real rc.19 package, isolated host databases and browser documents. It covers original-byte preservation, approved dimensions, rotation validation/ACK/replay/undo/restore, stable anchors, readonly guards, file roundtrips and idle/selection without writes. Package audit and check outcomes are recorded in `docs/verification/editor-package-upgrade-2026-10-14/report.json`; the source upgrade record is [the pending release note](releases/pending-editor-package-upgrade.md). This does not establish every diagram gesture, every spreadsheet operation or native-device acceptance.

## Spreadsheet hyperlink patch — 2026-10-15

Host 0.1.25 pins the actual registry artifact `@smartdoca/sheet` 0.2.2. Relative to 0.2.1, public entrypoints, dependency contracts and declarations are unchanged; Yjs/model/XLSX runtime JavaScript is byte-identical (some source maps differ). Hyperlink dialogs now cancel and restore the native draft correctly, and native unlink commands pass through the existing inline-link capability and readonly guard. The host continues using its stable editor/session, asset callbacks, native mutations and durable outbox. This patch changes no schema 6 encoding, immutable baseline, epoch, checkpoint or pending update identity and introduces no data conversion or compatibility adapter. Retain the previous package pin and lockfile for rollback. Audit and isolated verification are recorded in `docs/verification/sheet-package-upgrade-2026-10-15/`.

## Native editor upgrade — 2026-10-16

Host 0.1.27 pins the actual npm artifacts `@smartdoca/slate` 0.4.18 and `@smartdoca/sheet` 0.2.3. Entrypoints and dependency contracts are unchanged. Slate codec/Yjs/headless/conversion bytes match 0.4.15; the unchanged DOCX patch is bound to 0.4.18. The host accepts the native additional diagram shapes, node and edge styles and optional `canvasSettings`; AI commands validate and preserve these fields. Native graph editing includes the new workspace, automatic paper expansion, focused-draft Ctrl/Cmd+S saving and corrected floating selection toolbar.

The user explicitly approved native 19.8/79.2 worksheet defaults and graph behavior. New host documents, CRDT-appended worksheets (including historical appended worksheets) and virtual recovery sheets use 19.8-pixel rows / 79.2-pixel columns. Original immutable baseline fields, including omitted defaults, remain unchanged; explicit per-axis dimensions remain. No baseline, seed, checkpoint, epoch, sequence, pending-message identity or cell data is converted. Existing diagram fields remain untouched when opened; native defaults for absent canvas settings affect the view, and only an explicit graph save writes native graph fields/settings. Preview regeneration is view-only. Rich-text schema 3, spreadsheet schema 6 and durable ACK/outbox semantics remain unchanged. Existing historical readers and normalizers are retained without redesign.

Retain the original dependencies, lockfile, patch and deployment for rollback. Earlier editors may show different default dimensions/styles or ignore newly saved fields; no new historical-flowchart compatibility guarantee is introduced. Preserve all new writes when recovering; restoring old backups would discard later edits. Isolated verification, including an actual released 0.1.26 database, is recorded in `docs/verification/editor-package-upgrade-2026-10-16/`.

## Mind-map workspace upgrade — 2026-10-16

Host 0.1.29 pins the actual npm artifact `@smartdoca/slate` 0.4.20, including 0.4.19's diagram/media interaction fixes. Public entrypoints, dependencies and host component/handle declarations are unchanged. Codec, Yjs, headless and conversion runtime bytes match 0.4.18; the identical DOCX patch is bound to 0.4.20. AI guidance preserves the complete native mind map, including `structure`, `theme`, `background`, node `fontSize`/`bold` and `style:"underline"`.

The user explicitly approved the new native mind-map display defaults for existing documents. Opening an older map or regenerating its version-6 preview changes view state only; it does not rewrite original nodes, checkpoints, epochs or pending update identities. Opening and closing the workspace without saving produces no content commit. Explicit saving commits the native draft and derived preview through the existing Slate/Yjs outbox and durable ACK. No migration, field backfill or old-style adapter is introduced. Existing historical readers and normalization helpers remain in their established paths without redesign. Schema 3 and exact protocol checks remain unchanged; there are no SQL changes.

Keep the 0.1.28 deployment, original package artifact, dependency pin, patch and lockfile for rollback. Earlier editors may ignore new styles/settings or show different defaults. Preserve later writes when recovering; restoring a pre-upgrade backup discards subsequent edits. Tests use isolated synthetic documents/databases; verification and limits are recorded in `docs/verification/slate-workspace-upgrade-2026-10-16/`.

## Canvas thinking surfaces and resources — 2026-10-17 source increment

Current AidCanvas source extends `CanvasEditorResources` with optional `uploadAttachment(file, context)` beside `uploadImage`; both return stable `path` and file metadata. `CanvasResource` adds `id` and `kind: 'image' | 'attachment'`. `onResourcePreview(resource)` delegates preview to the host; it does not resolve or store a preview URL. The imperative handle adds `insertAttachmentFile`, while `insertImageFile` remains available. These source APIs are not yet a published package or installed Doca adapter. The existing Doca runtime and lockfile are unchanged; a future artifact upgrade must adapt these actual declarations explicitly.

Notes, cards and table cells share the native Slate editor, range formatting, Markdown and links. Cards/cells keep click-to-edit and bounded wrapping/scrolling. Notes first select/drag, then edit on another click; content determines their minimum height, and manual extra space is retained. Flowchart nodes, mind topics and connector labels retain object selection/dragging and double-click plain text editing. Object/cell alignment uses a shared icon panel (left, center, right, justify; top, middle, bottom); existing marks are retained when paragraph alignment changes. Pointer presence in a canvas leases horizontal overscroll boundaries on its ancestor scroll chain, restoring the previous styles on exit, blur and disposal. Vertical editable scrolling remains native. Rich media are real Slate void blocks with an empty required text child. Schema-1 `data.richText` records `{version:1,value:[{type:'paragraph',resource:{id,kind,path,name?,size?,mimeType?,width?,height?},children:[{text:''}]}]}`; the authoritative native `Text.text` contains one U+FFFC marker for each media block and newlines between blocks. Formatting/resource metadata still uses the existing whole-field LWW property; this does not claim character-level formatting CRDTs. There is no new transport, schema version, historical reader, migration or data backfill.

Pending files, progress, live insertion ranges, scroll offsets and resolved image URLs remain view state. Upload cancellation, closed targets, readonly transitions and disposal cannot insert elsewhere; uploads are never started by rendering or remote projection. Hosts still enforce storage limits, asset ACL, write permission, retention and cleanup of orphaned uploads. Canvas image/attachment objects and tagged host extensions support native connector ports. Export reads inline image bytes through the existing authorized `readImage` callback; attachments export readable metadata, without fetching their contents. The SDK does not own file-preview navigation or a global search panel.

Evidence and limits are recorded in AidCanvas `docs/design/feishu-thinking/resources-and-containers.md`. The isolated harness exercises the SDK callbacks and shared schema-1 model. This source increment does not establish production Doca asset-service, durable-server-ACK or npm-artifact acceptance.

## Three editor upgrade — 2026-10-17

Doca now pins the actual registry artifacts `@smartdoca/slate` 0.4.22 and `@smartdoca/slides` 0.3.0-alpha.3. Canvas uses the immutable `vendor/smartdoca-canvas-0.5.0-75e637df1a75.tgz`: the registry 0.5.0 library build tree-shook the Slate/plain-text inner-editor registration modules. The AidCanvas source repair marks both modules as side effects; the host consumes the rebuilt artifact. This artifact and source repair have not been published to npm.

Slate adds five pages of element-color presets and selects the whole diagram label when editing begins. Codec/Yjs/headless bytes match 0.4.20. The unchanged DOCX patch is rebound to 0.4.22. Canvas remains `aidcanvas-yjs` schema 1. Image and attachment callbacks store stable asset IDs, forward real progress and cancellation, and open host-owned authorized previews, including readonly history/trash/audit surfaces. The server validates new inline-media references against the current document's assets. Transient canvas presence forwards validated relative text positions and scene-coordinate pointers with server-owned identity/color; it supports pointer-only messages and never reuses permanent comment anchors.

Slides requires codec revision 6. Both client and server now negotiate `eppt-yjs-v6` with document schema 2/protocol 1. The user explicitly selected **new documents only**: existing `eppt-yjs-v5` documents and old clients are rejected, leaving original checkpoints, update logs, epochs, history and pending message identities untouched. No old-codec reader, metadata relabeling, automatic conversion, migration or SQL structure change is introduced. The host accepts the current native text-inset and table fields, and AI table commands expose merge/split, styles, resize, clear, paste and batch-axis deletion through the native controller. Table cells retain plain text with whole-cell formatting.

Update server and Web together. Keep the previous deployment, package pins, patch, lockfile and artifact. Returning to old code cannot promise readability of new writes; preserve later data before recovery. No user database was modified and no deployment was performed. Isolated acceptance, hashes, screenshots and limits are recorded in `docs/verification/three-editor-upgrade-2026-10-17/`.


## AI native canvas and presentation workflows — 2026-10-17

The host AI canvas tool composes the installed Canvas 0.5.0 public `CanvasModel` commands. `createFlowchart`, `createMindmap`, `createTable` and `createContainer` generate native schema-1 scenes; `table` applies bounded zero-based cell, region, axis and size operations through `applyScene`. These are host AI workflows, not newly exported editor SDK methods. Generic primitive drawing remains available. Table structure cannot be changed by raw child insertion/removal, placement, ungrouping or metadata replacement. Logical mind-topic deletion recursively removes descendants and mind edges, while surviving ordinary connectors detach deleted references.

The presentation tool uses the installed Slides 0.3.0-alpha.3 controller, including revision-6 table operations. Its element transforms and document size use EMU; `pageSize`, text padding/insets and table resize use CSS pixels; font sizes and letter spacing use points. Scoped presentation reads accept both slide and element IDs. Default outlines include native table identities, previews and geometry; canvas outlines include semantic kinds, logical references, cell positions and text lengths.

The user explicitly approved deleting canvas/PPT tool input aliases, automatic element guessing, flat-text reconstruction and pixel/EMU heuristics. Tool calls now use the exact declared current commands; obsolete call shapes fail without writes. This does not convert stored scenes, introduce historical readers, change the existing canvas schema/Slides codec rejection, or rewrite checkpoints, epochs, history or pending update identities. Unrelated spreadsheet/rich-text input normalization is unchanged. Retain the previous deployment and dependency artifacts for rollback; preserve later writes, and do not promise that old editors can read them. See `docs/ai-native-editors.md` for the tool contract and isolated acceptance entrypoint.


AI read/edit receipts also expose bounded current native-table facts (final dimensions, last-row indices and merge rectangles). Region acceptance uses final coordinates after structural edits. Polygon/Line point inputs use the current component's flat-number or point-object arrays; nested pairs are rejected, and Path uses `path`, never SVG `d`. Invalid input reports the actual field name rather than introducing an alias or implicit conversion. Root `add` accepts the shipped model's explicit `parentId:null`.

## Canvas 0.5.2 registry integration — 2026-10-17

Doca 0.1.31 pins the published `@smartdoca/canvas` 0.5.2 registry artifact. This supersedes the temporary 0.5.0 tarball above, which is removed from the runtime dependency/build path and retained in the preceding source snapshot for recovery. Public exports, dependencies and declaration signatures match that artifact; the sole declaration difference is a table-layout comment. The model runtime is byte-identical. No historical reader, stored-scene conversion, field backfill, codec/schema change or checkpoint/outbox replacement is introduced.

The package fixes consecutive Chinese composition, toolbar tracking during pan/zoom, and content-driven table row growth. Row geometry and text changes use the same native collaborative undo transaction. The host continues its stable model, authenticated resource/presence callbacks and durable ACK queue. Source, browser, image and publication verification is recorded in `docs/verification/release-0.1.31/`; the earlier 0.5.0 evidence remains dated evidence rather than proof of every 0.5.2 operation.

## Canvas attachment preview callback — 2026-10-18 / Canvas 0.5.3

AidCanvas source adds optional `CanvasEditorProps.onAttachmentPreview(resource: CanvasResource): void | Promise<void>`, matching the host-owned attachment-preview naming in slatetsx. It is used by both standalone and rich-content attachment preview buttons and the file toolbar. The latest supplied callback takes precedence for attachments; `onResourcePreview` remains the attachment fallback and the image callback. Synchronous throws and rejected promises go to `onError`. Preview receives only stable resource metadata and performs no URL resolution, content writes or collaboration transactions. Downloads still require the host's `resources.resolveDownloadUrl` authorization. Readonly permits these host actions without editing.

This optional API is published in [`@smartdoca/canvas` 0.5.3](https://www.npmjs.com/package/@smartdoca/canvas/v/0.5.3); the prior 0.5.2 declarations do not include it. The published archive matches the tested Node 22/npm 10 archive byte for byte. Public API typing and four browser scenarios passed in an isolated React 18 consumer, including latest callback dispatch, errors, readonly authorization, unchanged peer content and narrow file-toolbar tracking. The runnable Canvas demo and example host exercise it; production Doca remains on its installed 0.5.2 artifact and existing adapter. No host adapter, dependency lockfile, asset ACL, schema, codec, checkpoint or transport is changed by this source addition. Artifact upgrade/adaptation must be verified separately.

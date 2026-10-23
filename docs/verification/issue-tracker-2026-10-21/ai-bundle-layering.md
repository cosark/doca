# Shared AI interface dependency layering

The browser extension and website use the same `AIChat` view. Both website entry points (`app.tsx` and the document-side-panel `ai-document-layout.tsx`) now explicitly import `ai-chat-host.tsx`, which injects its current file pickers, resource search, personal settings, document-reference preview and registered plugin AI-block renderer. The extension entry continues to import `ai-chat.tsx` directly and receives no workspace components outside its connection permissions.

The shared view no longer imports the file explorer or the host plugin registry. `ai-generated-image.tsx` gets its document picker from the same runtime. `ai-markdown.tsx` uses the supplied host resolver on the website; its shared built-in file/folder cards are the same existing components. A further dependency edge was found in `AIReferenceTag`: its three lazy document previews still included all editor/preview chunks in the extension ZIP. The reference-preview implementation is now in the host-only `ai-reference-preview.tsx`; the same reference tag and the website preview API behavior remain in place.

No SDK adapters, global runtime bridge, database/storage changes, old-format readers or data conversions were introduced. The public current plugin registry remains the host’s AI-block source. No alias or empty replacement component is used.

## Build evidence

A complete extension build was written only to `.local/tmp-bundle-analysis`, never to the extension project’s `generated` directory. The baseline generated artifacts measured 54,665,139 bytes. The temporary build measured 9,011,841 bytes in 100 files: an 83.51% reduction. Mermaid, Markdown/code rendering, the model selector, progress, approvals, composer and conversation UI remain in the shared bundle. This measurement is a local build result; final MV3 ZIP packaging and extension-browser acceptance belong to the extension project.

## Verification

- The current web-plugin registry, folder/file answer parsing and reference-text suites passed: 21 tests.
- The normal local website browser suite passed using isolated synthetic accounts/documents: phone containment, yellow/blue spreadsheet backgrounds, canvas PNG delivery/download/replay/reload, deleted-source history/file retention and browser-source badges. No page exception or paid model call occurred.
- All five ordinary website history/upload cases passed after both full-screen and document-side-panel entries used the wrapper: late history snapshots, late errors, and collapse during session creation/upload with one submission.
- A second run used the real saved PNG receipt as a Markdown file link. A test-only probe on the existing host registry’s file-block render function confirmed that `.ai-answer .ai-file-card` was rendered through that registered resolver after the wrapper extraction; authorized thumbnail/download and reload passed. This probe was confined to the isolated browser session and is absent from production code.
- Evidence is in `ai-bundle-layering/`: build byte counts, normal website result, registered host-block result and its screenshot. Full temporary QA scripts and screenshots remain under `.local/ai-bundle-split-browser`, `.local/ai-plugin-block-browser` and `.local/tmp-bundle-analysis`.

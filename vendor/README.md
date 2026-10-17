# Canvas 0.5.0 artifact

Doca uses `smartdoca-canvas-0.5.0-75e637df1a75.tgz` because the registry 0.5.0 build omitted the native plain-text and Slate inner-editor registrations. Drawing and selection still worked, but entering label or rich-text editing could not open an editor.

Source: AidCanvas commit `4051b3b`, with only these additions to `package.json` → `sideEffects`:

```json
"**/thinking/PlainTextEditor.ts",
"**/thinking/SlateTextEditor.tsx"
```

Build with `yarn build:lib`, then `npm pack --ignore-scripts`. This checked-in tarball is immutable; the filename is qualified by its SHA-256 prefix. Keep the exact file for installation and rollback. Package model/schema/epoch contracts are unchanged. This repair has not been published to npm.

SHA-256: `75e637df1a759b35b10c209af246a899c0938f4fcbe1c6fafc937948d3720a15`.

# Browser assistant

[简体中文](browser-assistant.zh-CN.md)

Open the account menu → **Browser assistant**, or `/#/browser-assistant`. Capture selected web content or the entire loaded page with original images, and use your Doca AI assistant in the extension sidebar.

## Install and sign in

Create a capture profile in Doca: create new documents under a chosen destination, or append to an existing rich-text / Markdown document. Configure the default profile, title rule (`{title}`, `{date}`) and AI instructions. Generated knowledge-book pages cannot be direct append targets.

Download and extract the extension from Browser connections. Enable developer mode in Chrome / Edge and load the extracted folder. Manifest V3 requires Chromium 116 or newer. A self-hosted ZIP is not click-to-install distribution; store publication and enterprise signing are not provided. Reload pages opened before installation.

The archive contains a Doca address only, with no account credential or activation deadline. Opening the extension uses this browser's existing Doca sign-in. If signed out, a normal Doca login page opens; sign in and return to the extension. Closing a Doca tab does not sign out. Website logout, expiration or session revocation invalidates the associated browser access. Switching accounts reloads that account's profiles and isolates unfinished material and AI state by connection.

The extension never reads or copies website cookies. A same-origin Doca page provides a 60-second single-use authorization code, proved with a SHA-256 challenge and random verifier. The exchanged restricted token lasts 10 minutes, remains in trusted extension session storage, and is reauthorized automatically. The server stores hashes and checks the original website session on every operation. When cookie restrictions prevent extension-side probing, the same-origin page verifies sign-in; passive polling can reuse a proof for up to 30 seconds, while user capture and AI operations recheck it.

## Capture, AI and server address

Use the selection toolbar or popup for capture. Whole-page capture includes loaded top-level DOM beyond the viewport. Retry reuses a request ID and does not duplicate committed content. Unsent material is kept in the current browser session and may need to be selected again after closing the entire browser.

AI uses Doca's models, metering and approval flow. Page content is included only when explicitly attached or sent from the selection toolbar. Continue the conversation in Doca. Connections initially allow AI; edit a connection in Doca to change its name or AI switch. Account and model policies still apply.

Edit **Doca server address** in the extension Connection tab, for example `https://doca.example.com`, without `/api/v1`, other paths or query parameters. Alternatively copy the public site configuration in Doca and paste it in the extension's expandable configuration section. Production requires HTTPS; loopback HTTP is allowed for development. The strict format is `{ "version": 2, "origin": "https://doca.example.com" }`. Switching sites verifies the account signed in there and never forwards the previous site's pending material.

## Revoke and restore

Revoke one or all browser connections in Doca. Access keys and outstanding codes stop working and associated browser AI jobs are cancelled. Being signed into the website does not restore a revoked connection. Explicitly choose Restore connection in Doca, then reconnect the extension. Automatic authorization reuses the installation binding and cannot create another connection to bypass revocation.

Saved documents, original images and conversations remain. Revocation and logout cannot undo committed transactions. Website-origin AI jobs in the same conversation remain independent. Browser tool/commit boundaries validate the current website session; this host cancels affected jobs after logout, while other executors recheck authorization at heartbeat and operation boundaries.

## Limits and upgrade

Capture preserves semantic text, headings, lists, code, links, ordinary tables, source attribution and original bitmap bytes. It does not reproduce arbitrary CSS/interaction, unloaded data, pagination, iframes, closed shadow roots, virtual lists, SVG, canvas or video. Supported images are PNG, JPEG, WebP and GIF: at most 20 MiB / 25 million pixels each, 100 images / 100 MiB total; Markdown is limited to 512 KiB. Failed required images prevent success. Pending tasks expire after 24 hours; cleanup removes unbound objects only.

AI tools provide bounded reads/search, capture and rich-text / Markdown edits inside the profile's resource scope and current user permissions. Arbitrary networking, scripts, plugin tools and unrestricted browser automation are unavailable.

Before first release, the owner approved replacing the previous activation-package / 180-day token design. Old v1 configuration, activation endpoints and tokens are rejected without conversion. Existing profiles, content, images, conversations and credential records remain. Update server, Web and extension together, use the public site configuration and sign in again. There is no old-authentication fallback or mixed-version contract.

Static extension files live in `apps/browser-extension` with no separate build step. The server generates uncached archives from a fixed file list and public site configuration. Both source and Docker deployments must include this directory. Current DDL adds two empty website-session/code tables alongside the retained five initial tables, without changing the compatibility generation or backfilling old credentials. See the [database upgrade contract](database-schema-evolution.md) and [login acceptance record](verification/browser-clipper-login-2026-10-21/README.md).

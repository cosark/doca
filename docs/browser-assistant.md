# Browser assistant

[简体中文](browser-assistant.zh-CN.md)

Open the account menu → **Browser assistant**, or `/#/browser-assistant`. Capture selected web content or the entire loaded page with original images, append a quick note to an authorized document, and use your Doca AI assistant in the extension sidebar.

## Install and sign in

Create a capture profile in Doca: create new documents under a chosen destination, or append to an existing rich-text / Markdown document. Configure the default profile, title rule (`{title}`, `{date}`) and AI instructions. Generated knowledge-book pages cannot be direct append targets.

Download and extract the configured extension using the button above the settings tabs. Enable developer mode in Chrome / Edge and load the extracted folder. Manifest V3 requires Chromium 116 or newer. A self-hosted ZIP is not click-to-install distribution; store publication and enterprise signing are not provided. Reload pages opened before installation.

The archive contains a Doca address only, with no account credential or activation deadline. Opening the extension uses this browser's existing Doca sign-in. If signed out, a normal Doca login page opens; sign in and return to the extension. Closing a Doca tab does not sign out. Website logout, expiration or session revocation invalidates the associated browser access. Switching accounts reloads that account's profiles and isolates unfinished material and AI state by connection.

The extension never reads or copies website cookies. A same-origin Doca page provides a 60-second single-use authorization code, proved with a SHA-256 challenge and random verifier. The exchanged restricted token lasts 10 minutes, remains in trusted extension session storage, and is reauthorized automatically. The server stores hashes and checks the original website session on every operation. When cookie restrictions prevent extension-side probing, the same-origin page verifies sign-in; passive polling can reuse a proof for up to 30 seconds, while user capture and AI operations recheck it.

## Capture, AI and server address

Choose a capture rule on the popup home, then capture the current page, capture the selection, or hand it to AI. The default rule is preselected and other rules remain available. Selecting page text shows a small Doca icon; click it to expand the rule selector and capture / AI actions. Whole-page capture includes loaded top-level DOM beyond the viewport. Retry reuses a request ID and does not duplicate committed content. Unsent material is kept in the current browser session and may need to be selected again after closing the entire browser.

The AI action opens the browser's right side panel with the same Doca chat UI, model selector, Markdown, progress and approvals. Opening the panel does not call a model. Sending a message includes the current page by default; entering from the selection toolbar uses that selection. There is no attach-page checkbox. AI uses Doca's models, metering and approval flow. Continue the conversation in Doca. Connections initially allow AI; edit a connection in Doca to change its name or AI switch. Account and model policies still apply.

New AI sends are saved transactionally in IndexedDB before the input is consumed, scoped to the Doca site, account, connection and selected profile. Refreshing can continue the original message ID; a job already accepted by the server is reconciled before any new page capture or submission. Previous localStorage pending messages remain unchanged and require an explicit Continue or Withdraw with the current model and scope selected.

Use the top-right settings icon to open Doca's capture-rule settings or edit **Doca server address**, for example `https://doca.example.com`, without `/api/v1`, other paths or query parameters. Alternatively copy the public site configuration in Doca and paste it in the extension's expandable configuration section. Production requires HTTPS; loopback HTTP is allowed for development. The strict format is `{ "version": 2, "origin": "https://doca.example.com" }`. Switching sites verifies the account signed in there and never forwards the previous site's pending material.

## Quick notes

Expand **Quick note** below the three capture actions. Explicitly choose an existing rich-text or Markdown document from an enabled append rule, enter text and select **Append note**. No target is selected automatically. Create rules do not authorize an existing-document target; configure an append rule in Doca if the list is empty. This action preserves existing content, reads no web page and calls no AI. Markdown receives ordinary source text and follows the document's current rendering behavior.

The target and text live only in the current extension view. Closing or reloading it clears them. Switching sites, accounts or connections clears the target and send binding while retaining the current text for the user to handle. A successful acknowledgement clears only the text that was sent; a newer draft remains.

If the result is uncertain, the view keeps the text and document link. **Retry the same note** continues the original attempt without appending it again when already accepted. A stopped attempt must be checked in the target document before explicitly ending it or starting a new note; ending an attempt does not undo saved content. Expired send state or a server restart can prevent further retry. See the [quick-note contract](browser-quick-note.md) for deployment and failure boundaries.

## Revoke and restore

Revoke one or all browser connections in Doca. Access keys and outstanding codes stop working and associated browser AI jobs are cancelled. Being signed into the website does not restore a revoked connection. Explicitly choose Restore connection in Doca, then reconnect the extension. Automatic authorization reuses the installation binding and cannot create another connection to bypass revocation.

Saved documents, original images and conversations remain. Revocation and logout cannot undo committed transactions. Website-origin AI jobs in the same conversation remain independent. Browser tool/commit boundaries validate the current website session; this host cancels affected jobs after logout, while other executors recheck authorization at heartbeat and operation boundaries.

## Limits and upgrade

Before upgrading or rolling back, stop queue sending and close all older Doca pages and extensions. Do not run old and new senders together. Preserve localStorage, IndexedDB, retained tombstones and all later data. Rollback keeps queue sending disabled: it does not export the new store into localStorage or re-enable an older sender. An old version without a safe sender-disable facility cannot resume queue sending. See the [approved preservation and rollback contract](verification/issue-tracker-2026-10-21/ai-pending-idb.md).

Capture preserves semantic text, headings, lists, code, links, ordinary tables, source attribution and original bitmap bytes. It does not reproduce arbitrary CSS/interaction, unloaded data, pagination, iframes, closed shadow roots, virtual lists, SVG, canvas or video. Supported images are PNG, JPEG, WebP and GIF: at most 20 MiB / 25 million pixels each, 100 images / 100 MiB total; Markdown is limited to 512 KiB. Failed required images prevent success. Pending tasks expire after 24 hours; cleanup removes unbound objects only.

AI tools provide bounded reads/search, capture and rich-text / Markdown edits inside the profile's resource scope and current user permissions. Arbitrary networking, scripts, plugin tools and unrestricted browser automation are unavailable.

Before first release, the owner approved replacing the previous activation-package / 180-day token design. Old v1 configuration, activation endpoints and tokens are rejected without conversion. Existing profiles, content, images, conversations and credential records remain. Update server, Web and extension together, use the public site configuration and sign in again. There is no old-authentication fallback or mixed-version contract.

Extension files live in `apps/browser-extension`. `pnpm build:browser-extension` bundles the shared AI UI into local `generated/` assets and runs as part of `build`, `dev` and `dev:workspace`. The server packages these local assets, the fixed extension files and the public site configuration without loading remote scripts. Source and Docker deployments must include the built assets. Current DDL adds two empty website-session/code tables alongside the retained five initial tables, without changing the compatibility generation or backfilling old credentials. See the [database upgrade contract](database-schema-evolution.md) and [login acceptance record](verification/browser-clipper-login-2026-10-21/README.md).

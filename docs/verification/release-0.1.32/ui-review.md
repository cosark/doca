# Access tags and title icons — UI review

Existing Doca UI styles are retained. Access tags use white text on solid red `#c93237`, blue `#2465d8` and green `#15803d`, following the requested stronger colors. They stay beside home-page and top-left document titles; document tables have a separate Access column. Native rich-text title/heading components are untouched. The added controls are static, so no new motion is introduced.

Title parsing recognizes a single emoji grapheme followed by whitespace, including flags, keycaps, skin tones and ZWJ sequences. The stored title is unchanged. The picker offers common choices, manual entry and removal, with visible labels, Escape/outside dismissal and draft retention on failed save.

Three consecutive browser runs passed with isolated accounts and fresh synthetic documents. Desktop 1600px, narrow 390px and 800px (the effective layout width of a 1600px window at 200% zoom) screenshots were inspected. The 800px view exposed a squeezed-out header title; wrapping the header actions fixed it, and all final runs retain both the title and status. This is an effective-viewport check, not a claim of browser zoom emulation.

Reproduce with `DOCA_QA_OUTPUT=artifacts/resource-metadata-final node_modules/.bin/tsx scripts/qa-resource-metadata.mts`. Screenshots are generated locally by the script; no user data is used.

# UI review — 0.2.1

Reviewed by the main agent against screenshots from the live host using synthetic accounts and documents. This is a local adjustment using the existing component layout and visual language, with no added animation.

- Pale red, blue and green tags keep readable dark text. Home and top-left title tags use 11px text and 16px line height; document-list tags remain in a separate 96px permission column. Chinese and English are inspected.
- The editing header displays one selected emoji, with text only in the adjacent input. Full ZWJ/manual emoji replacement, exact unchanged spacing, failure recovery and normal FormData submission are exercised. Native body headings contain no access tag or custom title UI.
- The native rich-text toolbar palette contains the original faces and all 24 title icons exactly once. Insertion into a native heading converges to a second browser, persists across reload and has no peer echo or idle writes.
- Knowledge-library cards use the title emoji in the original icon position. New and renamed names save a single emoji prefix; reload restores it to the selector, removal restores the BookOpen icon, and the home activity title does not repeat it.
- Desktop 1600×1000, narrow 390×844 and 800×500 layouts are inspected. The 800px width represents the effective layout width of a 1600px viewport at 200% zoom; browser zoom itself is not emulated. Headers wrap actions with the title still visible. The narrow list scrolls horizontally while permission tags remain within their column.

Three consecutive final browser runs are retained in `resource-metadata-browser.json`. Selected screenshots accompany this record. Native device coverage and arbitrary editing/concurrency cases are outside these checks.

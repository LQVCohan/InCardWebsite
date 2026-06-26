# Frontend Flow Skill

Use this skill when a task affects how the browser app behaves.

## Flow to trace

For every UI feature, trace this path before changing code:

1. User action: click, input, paste, drop, keyboard shortcut, or file selection.
2. DOM entry point: element id, class, injected panel, or modal.
3. Event listener: the JavaScript function that receives the action.
4. State update: `cards`, `backImage`, selected settings, IndexedDB deck, or generated blob.
5. Render/update: `renderList`, `drawLayoutPreview`, `updateCounters`, status text, or modal refresh.
6. Output: screen change, saved deck, JSON/YDK/PDF/DOCX/ZIP file, or proxy request.

## Current important flows

### Image or YDK import

Drop zone or file input calls file handling. The result updates `cards`, renders the list, updates counters, and refreshes the layout preview.

### Deck manager

Deck actions read and write IndexedDB, then refresh the deck modal or current deck status.

### PDF/DOCX export

Export expands `cards` by quantity, normalizes or loads image buffers, creates the file, and downloads it in the browser.

### DeckLog import

The DeckLog panel reads a code or link, resolves card entries, preserves `qty`, appends to `cards`, then refreshes list, preview, and counters.

## Debug checklist

- Is the event listener attached after the DOM exists?
- Does the feature update all derived UI: list, counter, preview, and status text?
- Does quantity mean unique card count or total printed copies?
- Does export use the expanded list when it needs exact copies?
- Does an external image need the `/img?url=` proxy path?
- Does the feature still work when a browser blocks direct cross-origin image loading?

## Change rule

Do not change a later export/render function if the real issue is earlier in parsing, state, or quantity mapping.
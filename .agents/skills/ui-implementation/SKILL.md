# UI Implementation Skill

Use this skill when adding or changing interface behavior in this repository.

## Current architecture

This project is a plain web app:

- `server.js` serves `public/` and provides an image proxy.
- `public/index.html` owns the static DOM structure.
- `public/style.css` owns visual styling.
- `public/app.js` owns the main card list state, deck manager, import/export, and render functions.
- `public/decklog.js` extends the UI for DeckLog import and image ZIP export.

## Workflow

1. Start from the visible UI action.
2. Locate the element id or class in `index.html` or the injected panel.
3. Locate the event listener in JavaScript.
4. Trace state changes to `cards`, `backImage`, settings, IndexedDB, or generated files.
5. Trace the render function that updates the screen.
6. Check that counters, preview, and export still read the correct state.
7. Add CSS only when existing classes cannot express the layout.

## Implementation rules

- Prefer existing classes: `.btn`, `.outline`, `.primary`, `.secondary`, `.muted`, `.uploader`, `.controls`, `.actions`, `.preview-list`, `.deck-modal`.
- Keep new DOM ids unique and descriptive.
- Keep JavaScript browser-compatible; do not require a bundler.
- Use existing app functions before adding new helpers.
- When adding a new feature module, load it after `app.js` so it can reuse app functions.
- Keep copy in Vietnamese to match the current UI.

## UI state rules

Every feature with a button should provide feedback for:

- empty input
- loading or waiting
- success with counts or output name
- error with a useful reason
- disabled or unavailable state when applicable

## Accessibility basics

- Buttons must be real `button` elements.
- Inputs need visible labels or clear placeholders.
- Modals need a clear close path.
- Keyboard users should be able to trigger the main action.
- Image previews need useful alt text.

## Before commit

Fetch the latest files to be edited, then cite the changed lines after the update.
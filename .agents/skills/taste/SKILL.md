# Taste Skill

Use this skill when designing, reviewing, or polishing UI.

## Goal

Taste means the interface feels intentional: clear hierarchy, calm spacing, consistent controls, and no accidental visual noise.

## Taste checklist

1. Start with the user's job, not with decoration.
2. Make the primary action obvious and reduce competing actions.
3. Group related controls together.
4. Use spacing to show relationship: tight for related items, wider for sections.
5. Use one visual language for buttons, cards, badges, inputs, modals, and alerts.
6. Make empty, loading, success, error, and disabled states visible and helpful.
7. Keep text short, specific, and action-oriented.
8. Prefer progressive disclosure when a panel has too many controls.
9. Keep contrast readable in supported color schemes.
10. Preserve print/export accuracy over decorative effects.

## For this project

- The app is a practical card-printing tool, so utility and reliability are more important than animation.
- Deck import, image preview, quantity control, and PDF/DOCX export must stay easy to understand.
- New panels should fit the existing `.uploader`, `.controls`, `.actions`, `.btn`, `.pill`, and modal patterns.
- Do not add a new style system if existing classes can be reused.

## Review questions

- Can a first-time user tell what to do next?
- Does each section have one clear reason to exist?
- Are high-risk actions visually separated from normal actions?
- Does the UI explain what happened after an import/export action?
- Is the interface still usable at laptop width and mobile width?

## Output expectation

When applying this skill, describe the visual intention and the tradeoff, not just the CSS property changed.
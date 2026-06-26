# Ponytail Skill

Use this skill before changing code in this repository.

## Purpose

Ponytail keeps changes small, traceable, and aligned with the existing project instead of adding quick patches.

## Required workflow

1. Read the relevant `.agents/skills/**/SKILL.md` files before editing.
2. If the user mentions `ponytail`, read this skill again before changing files.
3. Trace the real flow before editing:
   - static HTML element or UI action
   - JavaScript state and event handler
   - render/update function
   - export/import side effect
   - server/proxy behavior when relevant
4. Identify the root cause before adding code.
5. Prefer deleting duplicate code or reusing an existing helper over adding another workaround.
6. Edit the fewest files possible.
7. Follow the current repo pattern: plain HTML, CSS, and browser JavaScript served by Express.
8. Before committing, fetch the latest version of every file you will modify.
9. After committing, cite the exact file lines changed and say what was not tested.

## Guardrails

- Do not add a framework unless the user explicitly requests it.
- Do not introduce build tooling when a small plain-JS change is enough.
- Do not move unrelated code while fixing a bug.
- Do not make visual changes that break existing PDF/DOCX/deck import behavior.
- Do not hide a failure with a generic catch if the user needs to understand why it failed.

## Definition of done

A change is done only when the modified flow is understandable from UI action to final visible result, and the answer explains the exact files changed.
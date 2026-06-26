# GSAP Animation Master Skill

Project adaptation of the official `greensock/gsap-skills` guidance.

Source reference:
- https://github.com/greensock/gsap-skills
- Official repo summary: AI skills for GSAP core API, timelines, ScrollTrigger, plugins, framework use, and performance.
- License of upstream repository: MIT.

## When to use

Use this skill when improving web UI motion, micro-interactions, modal transitions, card/list entrance animation, drag/drop feedback, loading feedback, or any JavaScript animation in this project.

## Project context

This repository is a plain HTML/CSS/browser-JS app served by Express.

Important files:
- `public/index.html` loads the browser scripts.
- `public/style.css` owns static visual style.
- `public/app.js` owns card state, render list, deck manager, preview, and export flows.
- `public/decklog.js` injects the DeckLog import panel.
- `public/gsap-ui.js` owns GSAP-only interface motion.

## GSAP rules for this repo

1. Use GSAP only for motion; do not move business logic from `app.js` into animation code.
2. Prefer `gsap.to`, `gsap.from`, and `gsap.fromTo` for simple UI motion.
3. Prefer `gsap.timeline` when sequencing multiple interface elements.
4. Prefer `x`, `y`, `scale`, `rotation`, and `autoAlpha` over animating layout properties.
5. Avoid animating `width`, `height`, `top`, `left`, `margin`, or `padding` unless there is no transform-based alternative.
6. Use stagger for groups such as cards, panels, and buttons.
7. Use short durations for utility UI: usually `0.18s` to `0.55s`.
8. Respect `prefers-reduced-motion`; skip or shorten motion when the user asks for reduced motion.
9. Do not add ScrollTrigger unless a page actually needs scroll-linked animation.
10. Do not add GSAP plugins unless the interaction requires them.
11. If GSAP CDN fails, the app must still work without animation.
12. Animation must never block import DeckLog/YDK, quantity changes, image preview, deck manager, PDF export, DOCX export, or ZIP export.

## Recommended motion map

- Initial page load: soft stagger entrance for header, uploader, DeckLog panel, controls, list, and preview.
- Buttons: tiny press/hover feedback only; keep them readable and practical.
- Drag/drop: pulse drop area or overlay with transform and autoAlpha.
- Card list: animate only newly added cards when possible.
- Modals: animate overlay/content on open; do not delay close if existing app hides immediately.
- Loading/import status: use a short pulse, not infinite busy animation unless the operation is actively running.

## Implementation pattern

```javascript
const mm = gsap.matchMedia();
mm.add('(prefers-reduced-motion: no-preference)', () => {
  gsap.defaults({ duration: 0.42, ease: 'power3.out', overwrite: 'auto' });

  const tl = gsap.timeline();
  tl.from('.topbar', { autoAlpha: 0, y: -12 })
    .from('.uploader, .controls, .preview-panel', { autoAlpha: 0, y: 18, stagger: 0.06 }, '<0.05');

  return () => tl.kill();
});
```

## Review checklist

Before committing GSAP work:
- Is the app usable if `window.gsap` is missing?
- Did the code read existing DOM/state instead of duplicating app logic?
- Are selectors scoped and stable?
- Are animations transform/opacity based?
- Is reduced motion respected?
- Did the change avoid unnecessary dependencies and plugins?
- Did the answer cite modified code lines and mention untested behavior?

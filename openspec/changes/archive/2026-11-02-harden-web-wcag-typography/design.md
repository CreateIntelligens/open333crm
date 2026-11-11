# Design

## Direction

Keep the incumbent restrained CRM visual language: cool neutral surfaces, one purposeful blue action color, and semantic status colors. Accessibility is handled in the token layer so existing pages inherit safer values without route-by-route color rewrites.

## Typography system

- Use Noto Sans TC as the authoritative CJK face and Inter as the Latin face.
- Set the Web body floor to 18px CSS (13.5pt) for the Chinese-first interface.
- Promote small utility classes to the same 18px floor and use line-height/weight/spacing to preserve hierarchy rather than shrinking labels.
- Keep headings at fixed, predictable steps and avoid fluid type in dense dashboard surfaces.

## Color system

- Replace low-contrast primary, muted, destructive, and status foregrounds with darker AA-safe foregrounds in light mode.
- Keep dark mode foregrounds bright enough on dark surfaces and use semantic subtle surfaces behind status labels.
- Provide a consistent 3px focus ring with offset and `:focus-visible` only.

## Interaction system

- Add a skip link and `main#main-content` to the dashboard shell.
- Raise shared button, input, tab, sidebar, and topbar control hit areas to at least 44px.
- Add ARIA tablist/tab/tabpanel relationships and `type="button"` to tab triggers.
- Add reduced-motion overrides, selection styling, and a stable page overflow strategy.

## Verification

- Unit tests assert the CSS accessibility contract and shared Tabs ARIA behavior.
- Run the Web tests, build, `impeccable detect --json` on changed UI targets, and a manual/Playwright smoke check at desktop and narrow viewport sizes.

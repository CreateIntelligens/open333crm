# Proposal

## Why

The Web CRM currently mixes low-contrast semantic colors, undersized Chinese text, and controls below comfortable touch and keyboard sizes. These issues reduce readability and make common dashboard work harder for low-vision, keyboard, and touch users.

## What Changes

- Establish WCAG AA-safe light and dark theme tokens for text, actions, status colors, borders, and focus rings.
- Make the Web app's Chinese reading floor 13.5pt (18px CSS) and remove sub-18px UI text from shared and global utility paths.
- Standardize focus-visible treatment, reduced-motion behavior, selection colors, form controls, and 44px touch targets.
- Improve dashboard shell landmarks, skip navigation, sidebar controls, and tab semantics without changing product routes or business behavior.
- Add automated regression coverage for the design-system accessibility contract and shared tab semantics.

## Capabilities

### New Capabilities

- `web-accessibility-system`: WCAG AA color, typography, focus, touch-target, motion, and shared-control behavior for the authenticated Web CRM.

### Modified Capabilities

- None.

## Impact

- Affected code: `apps/web/src/app/globals.css`, dashboard shell/layout, shared layout and UI components, and representative Web unit tests.
- No API, database, route, or external integration changes.
- The larger text floor may increase vertical density and requires responsive verification on dashboard, login, and shared form surfaces.

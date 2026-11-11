# web-accessibility-system Specification

## Purpose
Define the Web CRM accessibility foundation for readable Chinese-first operations, WCAG AA semantic colors, keyboard and touch access, native tab semantics, reduced motion, and dashboard landmarks.

## Requirements

### Requirement: WCAG AA theme tokens
The Web CRM SHALL use the Figma design-system palette for its semantic theme tokens in light and dark themes. Normal text, success, warning and AI foreground combinations SHALL meet WCAG 2.2 AA contrast. The light-theme primary action, muted text and destructive action, and the dark-theme success and AI labels on their subtle surfaces, keep the Figma colors by product decision and are documented exceptions to the 4.5:1 threshold.

#### Scenario: Light theme primary action
- **WHEN** a primary action is rendered in the light theme
- **THEN** its background is the Figma brand blue `#378ADD` (`210 71% 54%`) with white text, and its hover color `#2876C4` remains distinguishable

#### Scenario: Semantic status text
- **WHEN** body text, or success, warning, or AI text in the light theme, or warning text in the dark theme, is rendered on its associated surface
- **THEN** the semantic foreground has at least 4.5:1 contrast and the state is not conveyed by color alone

#### Scenario: Documented contrast exceptions
- **WHEN** muted text `#707E93` is rendered on the light background, white text is rendered on the destructive red `#EE3134`, or dark-theme success or AI text is rendered on its subtle surface
- **THEN** the token values match the Figma palette even though their contrast is below 4.5:1

### Requirement: Chinese typography floor
The Web CRM SHALL render Chinese UI copy at a minimum of 13.5pt (18px CSS) while preserving a readable hierarchy for headings, body copy, labels, and metadata.

#### Scenario: Small utility text
- **WHEN** a Chinese label uses a small utility text class or inherits body typography
- **THEN** the rendered font size is at least 18px and the line height remains sufficient for Chinese glyphs

#### Scenario: Narrow responsive layout
- **WHEN** the viewport narrows or browser text size increases
- **THEN** Chinese labels remain readable without clipping, hidden focus, or horizontal page overflow

### Requirement: Keyboard and touch access
Shared Web CRM controls SHALL expose visible keyboard focus, minimum 44px interactive targets, and native semantics for navigation and tabs.

#### Scenario: Keyboard focus
- **WHEN** a user tabs to a shared button, link, input, sidebar control, or tab
- **THEN** a visible high-contrast focus indicator identifies the focused control without changing layout

#### Scenario: Touch target
- **WHEN** a user operates a shared control on a touch viewport
- **THEN** its interactive hit area is at least 44px in both dimensions unless the control is an inline text link inside a larger target

#### Scenario: Tabs semantics
- **WHEN** a tab set renders its active and inactive tabs
- **THEN** the tab list, tab buttons, selected state, and tab panel expose matching ARIA roles and relationships

### Requirement: Motion and shell landmarks
The authenticated dashboard SHALL provide a skip link and main landmark, and state transitions SHALL respect reduced-motion preferences without removing focus or status feedback.

#### Scenario: Skip navigation
- **WHEN** keyboard users activate the skip link
- **THEN** focus moves to the dashboard main content landmark

#### Scenario: Reduced motion
- **WHEN** the user prefers reduced motion
- **THEN** non-essential transitions are shortened or removed while content, focus, loading, and status changes remain available

## ADDED Requirements

### Requirement: WCAG AA theme tokens
The Web CRM SHALL use semantic theme tokens whose normal text and interactive foreground combinations meet WCAG 2.2 AA contrast thresholds in light and dark themes.

#### Scenario: Light theme primary action
- **WHEN** a primary action is rendered in the light theme
- **THEN** its foreground and background combination has at least 4.5:1 contrast for normal text, and its hover and focus states remain distinguishable

#### Scenario: Semantic status text
- **WHEN** success, warning, destructive, AI, or muted text is rendered on its associated surface
- **THEN** the semantic foreground has at least 4.5:1 contrast and the state is not conveyed by color alone

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

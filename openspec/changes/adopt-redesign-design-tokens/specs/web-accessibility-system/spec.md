## MODIFIED Requirements

### Requirement: WCAG AA theme tokens
The Web CRM SHALL use the redesign palette decided by the designer for its semantic theme tokens in light and dark themes. In the light theme, normal text, muted text, primary action, destructive action, success, warning and AI foreground combinations SHALL meet WCAG 2.2 AA contrast of 4.5:1. The input and divider border keeps the Figma Border/Default color, and the dark-theme success and AI labels on their subtle surfaces keep their colors; these are documented exceptions by design decision.

#### Scenario: Light theme primary action
- **WHEN** a primary action is rendered in the light theme
- **THEN** its background is `210 66% 46%` (`#2876C4`) with white text at a contrast of at least 4.5:1, and its hover color is `210 68% 37%` (`#1F5FA0`)

#### Scenario: Semantic status text
- **WHEN** body text or muted text is rendered on the light background, or white text is rendered on the light-theme primary, destructive, success, warning or AI color, or warning text is rendered on its dark-theme subtle surface
- **THEN** the combination has at least 4.5:1 contrast and the state is not conveyed by color alone

#### Scenario: Documented contrast exceptions
- **WHEN** an input or divider border is rendered on the light background, or dark-theme success or AI text is rendered on its subtle surface
- **THEN** the border token is the Figma Border/Default `214 32% 91%` (`#E2E8F0`) and the dark-theme subtle tokens keep their values, even though their contrast is below the WCAG threshold

### Requirement: Chinese typography floor
The Web CRM SHALL render UI copy with the Figma design-system type scale of 12, 14, 16, 18, 20, 24, 28 and 42px, with a minimum of 12px, while preserving a readable hierarchy for headings, body copy, labels, and metadata. The Web CRM SHALL NOT force a global minimum font size above the Figma scale.

#### Scenario: Small utility text
- **WHEN** a Chinese label uses the smallest utility text class or inherits body typography
- **THEN** the rendered font size is at least 12px and no global rule overrides the Figma type scale

#### Scenario: Narrow responsive layout
- **WHEN** the viewport narrows or browser text size increases
- **THEN** Chinese labels remain readable without clipping, hidden focus, or horizontal page overflow

### Requirement: Keyboard and touch access
Shared Web CRM controls SHALL expose visible keyboard focus, control sizes from the Figma design system, and native semantics for navigation and tabs.

#### Scenario: Keyboard focus
- **WHEN** a user tabs to a shared button, link, input, sidebar control, or tab
- **THEN** a visible high-contrast focus indicator identifies the focused control without changing layout

#### Scenario: Touch target
- **WHEN** a user operates a shared button or control
- **THEN** its height follows the Figma sizes (buttons 40, 36, 32 or 28px) and no global rule forces a 44px minimum height

#### Scenario: Tabs semantics
- **WHEN** a tab set renders its active and inactive tabs
- **THEN** the tab list, tab buttons, selected state, and tab panel expose matching ARIA roles and relationships

## MODIFIED Requirements

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

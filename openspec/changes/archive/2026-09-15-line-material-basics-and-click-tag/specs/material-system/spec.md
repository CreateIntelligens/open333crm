## ADDED Requirements

### Requirement: LINE Imagemap Postback Limitation Is Explicit

The system SHALL make explicit (in the imagemap editor UI) that LINE imagemap actions support only uri / message / clipboard action types, not postback. When a postback-type action is configured on an imagemap area, the system currently degrades it to a message action; this degradation SHALL be surfaced to the user rather than applied silently.

#### Scenario: Imagemap editor states postback is unsupported

- **WHEN** a user edits an imagemap area's action
- **THEN** the editor indicates postback is not available for imagemap (only uri / message / clipboard)

### Requirement: LINE Video End-Card Is Documented Best-Effort

The system SHALL document that LINE native video messages do not include CTA buttons, and that the `line_video` end-card CTA is delivered as a best-effort wrapper (an additional message following the video). This behavior SHALL be preserved; the requirement only clarifies the documented intent so future maintainers do not treat it as a native video capability.

#### Scenario: End-card behavior is documented

- **WHEN** a maintainer reads the line_video send-conversion code
- **THEN** a comment explains the end-card is a best-effort wrapper, not native LINE video CTA

## ADDED Requirements

### Requirement: Advanced Visual Structure Editing (Opt-in)

The system SHALL provide an advanced visual editing mode for Flex materials, entered from the fill-in editor via "轉為進階編輯". It SHALL present a structure tree (add / remove / drag-reorder components), a live preview, and a properties panel. This mode SHALL NOT be the default; template fill-in remains the default. Reordering SHALL use drag-and-drop (not up/down buttons). The single source of truth SHALL be the LINE Flex JSON — the tree and preview are derived views, not separately-synced mirrors.

#### Scenario: Enter advanced mode from fill-in

- **WHEN** a user clicks "轉為進階編輯" in the fill-in editor
- **THEN** the advanced visual editor opens with the current Flex JSON, showing structure tree + preview + properties

#### Scenario: Drag to reorder

- **WHEN** a user drags a component in the structure tree
- **THEN** its order changes and the preview updates (no up/down buttons required)

#### Scenario: Fill-in remains the default

- **WHEN** a user creates a new Flex material
- **THEN** they land in template fill-in, not the advanced editor

### Requirement: Nesting Rules and Advanced Properties

Component nesting SHALL be governed by a declarative allows-whitelist registry (which component may contain which). Core properties SHALL be shown directly; advanced style properties SHALL be collapsed. LINE validation errors SHALL map back to the corresponding tree node / field and be highlighted.

#### Scenario: Invalid nesting prevented

- **WHEN** a user tries to add a component where it is not allowed
- **THEN** the action is prevented per the allows registry

#### Scenario: LINE error highlighted on node

- **WHEN** LINE validation returns an error for a specific path
- **THEN** the corresponding tree node / field is highlighted

### Requirement: Visual and Raw JSON Are Bidirectional

The advanced editor SHALL allow switching between visual editing and raw JSON view; edits in either reflect in the other, over the same underlying Flex JSON. Converting back to fill-in mode SHALL preserve structure the fill-in view cannot represent (only mappable named fields are editable there; the rest is retained unchanged).

#### Scenario: Toggle to raw JSON and back

- **WHEN** a user switches to raw JSON, edits, and switches back to visual
- **THEN** the visual editor reflects the JSON edits

#### Scenario: Round-trip to fill-in preserves complex structure

- **WHEN** an advanced-edited material is opened in fill-in mode
- **THEN** mappable fields are editable and non-mappable structure is retained unchanged

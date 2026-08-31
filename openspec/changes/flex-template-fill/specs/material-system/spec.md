## ADDED Requirements

### Requirement: Flex Template Fill-in Editing Is the Default

Creating a LINE Flex material SHALL default to a "pick a template, then fill in the blanks" flow rather than pasting JSON. The editor SHALL start from an official template (existing showcase samples), and the user SHALL edit only business-meaningful fields. Pasting raw Flex JSON SHALL remain available as an advanced/developer entry point.

#### Scenario: Flex creation starts from a template

- **WHEN** a user creates a LINE Flex material
- **THEN** the editor presents template selection and, after picking one, a fill-in-the-blanks form (not a raw JSON textarea)

#### Scenario: Paste JSON remains available

- **WHEN** a developer chooses the advanced entry
- **THEN** they can still paste LINE Flex Simulator JSON

### Requirement: Fields Grouped by Business Meaning

The fill-in editor SHALL group editable fields into business-meaningful sections (e.g. 主圖 / 標題與內文 / 價格 / 按鈕) using template-provided slot metadata where available, falling back to position-based inference. Technical Flex terminology (box, flex, gravity, offset) SHALL NOT be exposed in the default view.

#### Scenario: Fields shown as business sections

- **WHEN** a user edits a "商品促銷" template
- **THEN** they see sections like 主圖 / 標題與內文 / 價格 / 按鈕, not raw box/text nodes

#### Scenario: Each field has the right input type

- **WHEN** the form renders
- **THEN** image fields show an uploader, text fields show a text input, and button fields show text + link inputs

### Requirement: Advanced Style Properties Are Hidden by Default

Style properties (color, font size, weight, alignment, spacing) SHALL be collapsed under an "進階設定" toggle per section, hidden by default. The default view SHALL show only core values (text content, image, button text + link).

#### Scenario: Advanced properties collapsed

- **WHEN** the fill-in form loads
- **THEN** color/font-size/alignment controls are hidden until the user expands "進階設定"

### Requirement: Live Preview and Test Send

The editor SHALL show a live phone preview (via the existing renderer) that updates as fields change, and SHALL support test-send to the user's own LINE and saving as a material.

#### Scenario: Preview updates on edit

- **WHEN** a user changes the title field
- **THEN** the phone preview reflects the new title immediately

#### Scenario: Save and test send

- **WHEN** a user finishes filling in
- **THEN** they can save it as a line_flex material and test-send it to their own LINE

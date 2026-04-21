## MODIFIED Requirements

### Requirement: Frontend attachment picker MIME filter
The inbox `MessageInput` component's file picker SHALL accept only `image/png` files. The `accept` attribute on the hidden `<input type="file">` element SHALL be set to `image/png` only.

#### Scenario: PNG file selected
- **WHEN** an agent clicks the attachment button and selects a PNG file
- **THEN** the browser opens a file picker filtered to PNG files

#### Scenario: Non-PNG file excluded by picker
- **WHEN** an agent opens the file picker
- **THEN** files with MIME types other than `image/png` are not selectable (browser-level filter)

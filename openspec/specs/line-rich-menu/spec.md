## ADDED Requirements

### Requirement: Rich Menu CRUD
The system SHALL allow administrators to create, read, update, and delete LINE Rich Menus via the Admin Console.

#### Scenario: Create Rich Menu
- **WHEN** an administrator submits a Rich Menu configuration (size, chatBarText, areas with actions)
- **THEN** the system calls `POST /v2/bot/richmenu`, stores the returned `richMenuId` in `RichMenu.lineRichMenuId`, and uploads the background image via `POST /v2/bot/richmenu/{richMenuId}/content`

#### Scenario: List all Rich Menus
- **WHEN** an administrator opens the Rich Menu management page
- **THEN** the system returns all Rich Menus from the local DB, reflecting current state on LINE platform

#### Scenario: Delete Rich Menu
- **WHEN** an administrator deletes a Rich Menu
- **THEN** the system calls `DELETE /v2/bot/richmenu/{richMenuId}` on LINE API and removes the record from DB

---

### Requirement: Default Rich Menu
The system SHALL allow setting and cancelling a default Rich Menu shown to all followers.

#### Scenario: Set default
- **WHEN** an administrator sets a Rich Menu as default
- **THEN** the system calls `POST /v2/bot/user/all/richmenu/{richMenuId}` and marks `RichMenu.isDefault = true`

#### Scenario: Cancel default
- **WHEN** an administrator cancels the default Rich Menu
- **THEN** the system calls `DELETE /v2/bot/user/all/richmenu`

---

### Requirement: User Rich Menu binding
The system SHALL support binding and unbinding a specific Rich Menu to individual contacts or batches of contacts.

#### Scenario: Bind single user
- **WHEN** an Automation Action `CHANNEL_UI_SWITCH` is triggered for a contact
- **THEN** the system calls `POST /v2/bot/user/{userId}/richmenu/{richMenuId}`

#### Scenario: Batch bind via Marketing
- **WHEN** a Rich Menu binding is scheduled for a segment (up to 500 contacts)
- **THEN** the system enqueues a `rich-menu-batch` BullMQ job with rate limit of 3 executions/hour
- **THEN** calls `POST /v2/bot/richmenu/bulk/link` for each batch

---

### Requirement: Rich Menu Alias for A/B switching
The system SHALL support Rich Menu Alias to enable instant switch between menus (e.g., event vs. default) without re-binding users.

#### Scenario: Create alias
- **WHEN** an administrator creates an alias referencing a `richMenuId`
- **THEN** the system calls `POST /v2/bot/richmenu/alias` and stores the `aliasId`

#### Scenario: Switch alias target
- **WHEN** an administrator updates the alias to point to a different `richMenuId`
- **THEN** all users bound to that alias see the new Rich Menu instantly without rebinding

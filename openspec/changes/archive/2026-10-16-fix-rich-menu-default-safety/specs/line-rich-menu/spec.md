## MODIFIED Requirements

### Requirement: Default Rich Menu
The system SHALL allow setting and cancelling a default Rich Menu shown to all followers. A Rich Menu with `selected = true` becomes the default for all followers of its LINE official account when it is published. The web console SHALL create new drafts with `selected = false`, and SHALL ask for confirmation in plain words before an action that changes the menu of all followers.

#### Scenario: Set default
- **WHEN** an administrator publishes a Rich Menu whose `selected` is true
- **THEN** the system calls `POST /v2/bot/user/all/richmenu/{richMenuId}` and the menu becomes the default for all followers

#### Scenario: Cancel default
- **WHEN** an administrator unpublishes a Rich Menu whose `selected` is true
- **THEN** the system calls `DELETE /v2/bot/user/all/richmenu`

#### Scenario: New draft is not the default
- **WHEN** an administrator picks a layout to create a new Rich Menu
- **THEN** the option「設為所有好友的預設選單」is unchecked

#### Scenario: Check the default option
- **WHEN** an administrator checks「設為所有好友的預設選單」
- **THEN** the console asks for confirmation that says publishing replaces the menu of all followers, and the option stays unchecked if the administrator cancels

#### Scenario: Publish a default menu
- **WHEN** an administrator publishes a Rich Menu whose `selected` is true
- **THEN** the confirmation says the menu replaces the menu that all followers see now

#### Scenario: Unpublish a default menu
- **WHEN** an administrator unpublishes a Rich Menu whose `selected` is true
- **THEN** the confirmation says all followers lose the default menu

## ADDED Requirements

### Requirement: Rich Menu Audience Binding

The system SHALL allow a published Rich Menu to be bound to an audience (a Segment or a tag), so that different audiences see different Rich Menus. Binding SHALL resolve the audience to contacts, then to their LINE user ids (via LINE channel identities), and link the menu to those users through LINE's bulk-link API. Binding SHALL only be allowed for a Rich Menu whose status is `published` (with a `lineRichMenuId`); draft or errored menus SHALL be rejected with a clear "publish first" error. Binding SHALL run as a background batch (audiences may be large and LINE bulk-link is rate-limited), and the API SHALL return immediately with the number of users queued.

#### Scenario: Bind published menu to a segment

- **WHEN** a user binds a published Rich Menu to a segment
- **THEN** the segment's contacts with LINE identities are resolved to user ids and a background job links the menu to those users
- **AND** the API returns the queued user count

#### Scenario: Binding a draft menu is rejected

- **WHEN** a user attempts to bind a Rich Menu whose status is not `published`
- **THEN** the request is rejected with an error indicating the menu must be published first

#### Scenario: Different audiences see different menus

- **WHEN** menu A is published as the all-default and menu B is bound to the VIP audience
- **THEN** VIP users see menu B (per-user binding takes precedence over all-default) and everyone else sees menu A

### Requirement: Rich Menu Audience Unbinding

The system SHALL allow unbinding a Rich Menu from an audience, removing the per-user link for those users (they revert to the all-default menu, if any). Unbinding SHALL also run as a background batch.

#### Scenario: Unbind an audience from a menu

- **WHEN** a user unbinds an audience from a Rich Menu
- **THEN** a background job unlinks those users' per-user menu and they revert to the all-default menu

### Requirement: Audience Binding Is Tenant-Scoped

Audience resolution and menu binding SHALL be tenant-scoped: only contacts of the current tenant are resolved, and only Rich Menus belonging to the tenant's channel may be bound.

#### Scenario: Binding does not cross tenants

- **WHEN** an audience is resolved for binding
- **THEN** only the current tenant's contacts and channel are used; other tenants' contacts are never linked

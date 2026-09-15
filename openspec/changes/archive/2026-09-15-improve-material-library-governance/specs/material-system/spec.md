## ADDED Requirements

### Requirement: Nested Material Categories

The system SHALL provide tenant-scoped, hierarchical material categories via a `MaterialCategory` entity supporting a single parent (`parentId`, nullable) so categories form a tree. Materials reference a category via `categoryId` (nullable). Categories and materials SHALL be freely re-assignable (movable) between categories. Moving a category under one of its own descendants SHALL be rejected to prevent cycles.

#### Scenario: Create a child category

- **WHEN** a user with `marketing.manage` creates a category "雙11檔期" with parent "行銷活動"
- **THEN** the category is created tenant-scoped with `parentId` set to the parent category
- **AND** it appears nested under its parent in the category tree

#### Scenario: Move a material to another category

- **WHEN** a user changes a material's `categoryId` to a different category
- **THEN** the material is re-assigned and appears under the new category in the list

#### Scenario: Reject moving a category into its own descendant

- **WHEN** a user attempts to set a category's `parentId` to one of its own descendant categories
- **THEN** the system rejects the move with a validation error and the tree is unchanged

#### Scenario: Deleting a category does not delete its materials

- **WHEN** a category containing materials is deleted
- **THEN** the category is removed and each affected material's `categoryId` is set to null (materials are retained, not deleted)

#### Scenario: Category is tenant-isolated

- **WHEN** tenant A queries the category tree
- **THEN** only tenant A's categories are returned and tenant B's categories are never visible

### Requirement: Material Tags

The system SHALL support multiple free-form tags per material stored as `Material.tags` (string array). The set of available tenant tags SHALL be derived by aggregating distinct tags across that tenant's materials (no separate tag table). Tags are tenant-scoped and orthogonal to categories.

#### Scenario: Tag a material

- **WHEN** a user with `marketing.manage` adds tags ["促銷", "會員"] to a material
- **THEN** the material stores both tags and they become selectable filters for that tenant

#### Scenario: Aggregate tenant tag list

- **WHEN** the tag list endpoint is queried
- **THEN** it returns the distinct union of tags across the tenant's materials

### Requirement: Material List Filtering and Sorting

The list endpoint SHALL support composite filtering by `categoryId`, `tags` (match materials having any of the given tags), `channelType`, `status`, and a name/description keyword, combinable in a single query. It SHALL support a `sort` selection among: most-recently-used (`lastUsedAt`), most-used (`usageCount`), recently-updated (`updatedAt`), and name.

#### Scenario: Filter by category and tag together

- **WHEN** a user filters by category "行銷活動" and tag "促銷"
- **THEN** only materials in that category (or its subtree, per implementation) that carry the tag are returned

#### Scenario: Sort by most-recently-used

- **WHEN** a user selects the "最近使用" sort
- **THEN** materials are ordered by `lastUsedAt` descending, with never-used materials ordered last

### Requirement: Material Last-Used Display

The material list SHALL surface each material's existing `lastUsedAt` value. Materials never used SHALL display an explicit "—" (not a fabricated timestamp).

#### Scenario: Show last-used time

- **WHEN** a material was last sent 2 hours ago
- **THEN** the list row shows a relative "2 小時前" (or equivalent) for that material

#### Scenario: Never-used material

- **WHEN** a material has null `lastUsedAt`
- **THEN** the list row shows "—" in the last-used column

### Requirement: Material Version History

The system SHALL retain a version snapshot each time a material is created or updated, via a `MaterialVersion` entity storing a monotonically increasing `versionNo`, a snapshot of `name` and `body`, the editing agent, and a timestamp. Users SHALL be able to view the version history and restore a prior version. Restoring SHALL write the selected version's `name`/`body` back onto the material AND create a new version entry (restore is itself an edit; linear history is preserved).

#### Scenario: Snapshot on update

- **WHEN** a user updates a material's body
- **THEN** a new `MaterialVersion` is written with the next `versionNo` capturing the submitted `name`/`body`

#### Scenario: View version history

- **WHEN** a user opens a material's version history
- **THEN** all versions are listed newest-first with `versionNo`, editor, and timestamp

#### Scenario: Restore a prior version

- **WHEN** a user restores version 2 of a material currently at version 5
- **THEN** the material's `name`/`body` are set to version 2's snapshot
- **AND** a new version 6 is created recording the restore

#### Scenario: Version history is tenant-isolated

- **WHEN** tenant A queries a material's versions
- **THEN** only versions belonging to tenant A's material are returned

### Requirement: Material-Level Performance Attribution

The system SHALL attribute usage and, where available, interaction outcomes to individual materials. Usage count and last-used time SHALL be surfaced per material. Interaction outcomes (e.g. reply count, cases opened) SHALL be derived by attributing broadcast recipient outcomes back to the source material. Where an interaction metric has no attributable data (e.g. no shortlink for click-through), the system SHALL display "暫無資料" rather than a fabricated zero.

#### Scenario: Show usage in list

- **WHEN** the material list renders
- **THEN** each row shows the material's usage count with a bar normalized against the tenant's maximum usage

#### Scenario: Attribute replies to a material

- **WHEN** a broadcast built from material M receives replies
- **THEN** material M's stats reflect the attributed reply count

#### Scenario: No attributable click data

- **WHEN** a material has no shortlink-based click attribution
- **THEN** the click-through metric displays "暫無資料", not 0

### Requirement: Material Display Status

The system SHALL provide a `Material.status` field (default `draft`) used for display and manual setting by `marketing.manage` users, with values `draft` and `approved` at minimum. This requirement covers display and manual state only; it does NOT define a submission/approval workflow (reviewer assignment, notifications, approve/reject actions), which is deferred to a separate change.

#### Scenario: Manually mark a material approved

- **WHEN** a user with `marketing.manage` sets a material's status to `approved`
- **THEN** the material's status is updated and the list shows an "已核准" badge

#### Scenario: Default status on creation

- **WHEN** a material is created without an explicit status
- **THEN** its status defaults to `draft` and the list shows a "草稿" badge

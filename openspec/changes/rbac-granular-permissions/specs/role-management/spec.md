## ADDED Requirements

### Requirement: Role Model with System and Custom Roles
The system SHALL persist roles in a `Role` table scoped by `tenantId`, each with a `slug`, `name`, `isSystem` flag, and associated RolePermission rows. There SHALL be exactly three system roles per tenant with slugs `admin`, `supervisor`, and `agent`. System roles SHALL NOT be deletable and their `slug` SHALL NOT be editable. Custom roles MAY be created, renamed, and deleted by an authorized user.

#### Scenario: System roles exist per tenant
- **WHEN** a tenant is provisioned (or migrated)
- **THEN** three system roles with slugs `admin`, `supervisor`, `agent` SHALL exist for that tenant

#### Scenario: System role cannot be deleted
- **GIVEN** a role with `isSystem: true`
- **WHEN** a delete is attempted on that role
- **THEN** the API SHALL reject the request with an error

#### Scenario: Custom role can be created
- **GIVEN** a user holding `role.manage`
- **WHEN** a custom role "行銷專員" is created with a set of permissions
- **THEN** the role SHALL be persisted with `isSystem: false` and the given permissions

### Requirement: Custom Role Is Created Blank
A newly created custom role SHALL start with an empty permission set. The creation flow SHALL require only a role name; it SHALL NOT require or imply inheriting from, or copying, any existing role. After creation the user SHALL configure the role's permissions by selecting them individually. Any "copy from an existing role" capability, if offered, SHALL be an explicit optional shortcut and SHALL NOT be a required step of creation.

#### Scenario: Creating a role only requires a name
- **GIVEN** a user holding `role.manage`
- **WHEN** they create a custom role by providing only a name
- **THEN** the role SHALL be created with `isSystem: false` and an empty permission set
- **AND** the flow SHALL NOT require choosing a base or source role

#### Scenario: New role starts with no permissions
- **GIVEN** a custom role has just been created
- **WHEN** its permissions are inspected
- **THEN** it SHALL hold zero permissions until the user grants them individually

### Requirement: Role Management Requires role.manage Permission
Creating, updating, deleting roles and editing role-permission assignments SHALL require the `role.manage` permission. Viewing roles and the permission matrix SHALL require the `role.view` permission.

#### Scenario: User without role.manage cannot edit assignments
- **GIVEN** a request is authenticated and the agent's role does not hold `role.manage`
- **WHEN** a role-permission assignment change is attempted
- **THEN** the response SHALL be HTTP 403

#### Scenario: User with role.manage edits assignments
- **GIVEN** a request is authenticated and the agent's role holds `role.manage`
- **WHEN** a role-permission assignment change is submitted
- **THEN** the request SHALL proceed to the handler

### Requirement: Tenant Isolation for Roles and RolePermissions
All role and role-permission operations SHALL be scoped to the requester's tenant, taken from `request.agent.tenantId` (never from request body or query). `RolePermission` rows SHALL NOT be read or written by `roleId` alone: the API SHALL first verify the target `Role` belongs to the requester's tenant via a `tenantId`-scoped lookup, and SHALL respond HTTP 404 (`NOT_FOUND`) if it does not, before touching any `RolePermission` row. A role belonging to another tenant SHALL be indistinguishable from a nonexistent role.

#### Scenario: Editing a role of another tenant is rejected as not found
- **GIVEN** a user authenticated in tenant A holding `role.manage`
- **AND** a role `R` that belongs to tenant B
- **WHEN** the user submits a permission change for role `R`
- **THEN** the API SHALL respond HTTP 404 (`NOT_FOUND`)
- **AND** no `RolePermission` row of role `R` SHALL be read or modified

#### Scenario: Listing a role of another tenant is rejected as not found
- **GIVEN** a user authenticated in tenant A holding `role.view`
- **AND** a role `R` that belongs to tenant B
- **WHEN** the user requests role `R`'s permissions
- **THEN** the API SHALL respond HTTP 404 (`NOT_FOUND`)

#### Scenario: tenantId comes only from the token
- **GIVEN** a user authenticated in tenant A
- **WHEN** they submit a role operation whose request body includes a `tenantId` field for tenant B
- **THEN** the operation SHALL be scoped to tenant A (from the token) and the body `tenantId` SHALL be ignored

#### Scenario: Deleting a role cascades its RolePermission rows
- **GIVEN** a custom role in the requester's tenant with several granted permissions and no assigned agents
- **WHEN** the role is deleted
- **THEN** all of its `RolePermission` rows SHALL be removed with it, leaving no orphan rows

### Requirement: System Role Permissions Are Adjustable Within Safety Locks
The permissions of system roles SHALL be adjustable by an authorized user, EXCEPT that the `admin` system role SHALL retain a locked core set of permissions (at minimum `role.manage` and `agent.manage`) that cannot be removed. The API SHALL reject any operation that would remove a locked core permission from the `admin` role, or that would remove `role.manage` from the requester's own current role.

#### Scenario: Supervisor role permissions can be reduced
- **GIVEN** the `supervisor` system role holds `analytics.view`
- **WHEN** an authorized user removes `analytics.view` from the `supervisor` role
- **THEN** the change SHALL be accepted

#### Scenario: Admin core permission cannot be removed
- **WHEN** an attempt is made to remove `role.manage` from the `admin` system role
- **THEN** the API SHALL reject the request

#### Scenario: Self-lockout prevented
- **GIVEN** the requester's current role holds `role.manage`
- **WHEN** the requester attempts to remove `role.manage` from their own current role
- **THEN** the API SHALL reject the request

### Requirement: Assignment Honors dependsOn Constraints
When editing a role's permissions, the API SHALL enforce `dependsOn` prerequisites: an assignment that grants a permission without its prerequisites, or removes a prerequisite while a dependent remains, SHALL be rejected with HTTP 422 unless the operation also resolves the constraint (auto-adding prerequisites or auto-removing dependents).

#### Scenario: Granting dependent auto-includes prerequisite
- **GIVEN** `inbox.reply` dependsOn `inbox.view`
- **WHEN** a role is granted `inbox.reply` in an operation that also grants `inbox.view`
- **THEN** the assignment SHALL be accepted

#### Scenario: Contradictory assignment rejected
- **GIVEN** a role would end up holding `inbox.reply` without `inbox.view`
- **WHEN** the assignment is submitted without resolving the dependency
- **THEN** the API SHALL respond HTTP 422 naming the missing prerequisite

### Requirement: Deleting a Role In Use Is Guarded
Deleting a custom role that is still assigned to one or more agents SHALL be rejected unless those agents are first reassigned to another role. The API SHALL indicate how many agents block the deletion.

#### Scenario: Delete blocked while agents assigned
- **GIVEN** a custom role assigned to 2 agents
- **WHEN** a delete is attempted on that role
- **THEN** the API SHALL reject the request indicating 2 agents must be reassigned first

#### Scenario: Delete succeeds after reassignment
- **GIVEN** a custom role with no agents assigned
- **WHEN** a delete is attempted
- **THEN** the role SHALL be deleted

### Requirement: Permission Matrix Data Contract
The API SHALL expose the data needed to render the permission matrix: the list of roles (with `isSystem`) and, for each permission point, its `code`, `group`, `label`, `description`, and `dependsOn`. Implied (`implies`) relationships SHALL NOT be exposed as assignable matrix cells.

#### Scenario: Matrix groups permissions and marks system roles
- **WHEN** the matrix endpoint is called by a user holding `role.view`
- **THEN** the response SHALL list roles marked with `isSystem` and permissions organized by `group`
- **AND** it SHALL NOT present implied permissions as separately assignable cells

### Requirement: Role Permission Settings Page Layout
The settings page for roles and permissions SHALL present a per-role editing layout: a role list (left) and the selected role's permission list (right) organized by `group` with collapsible sections. It SHALL use the existing UI component library and semantic Tailwind tokens (light/dark aware). It SHALL NOT render a full two-dimensional role-by-permission grid that forces horizontal page scrolling.

#### Scenario: Selecting a role shows its permissions grouped
- **GIVEN** the role settings page is open and a role is selected
- **WHEN** the permission list renders
- **THEN** permissions SHALL be displayed grouped by `group` in collapsible sections, each showing an on/off count and a whole-group toggle

#### Scenario: No horizontal page scroll
- **WHEN** the role settings page renders on a narrow viewport
- **THEN** the page body SHALL NOT scroll horizontally

### Requirement: Dependency-Aware Checkbox Interaction
When a user toggles a permission in the settings UI, `dependsOn` relationships SHALL be reflected interactively: enabling a permission SHALL auto-enable its prerequisites (with a visible "auto-enabled" hint), and disabling a prerequisite SHALL prompt a confirmation that lists the dependent permissions that will also be disabled.

#### Scenario: Enabling a dependent auto-enables its prerequisite
- **GIVEN** `inbox.reply` dependsOn `inbox.view` and neither is enabled
- **WHEN** the user checks `inbox.reply`
- **THEN** `inbox.view` SHALL also become checked and SHALL show an "auto-enabled because 回覆對話 requires it" style hint

#### Scenario: Disabling a prerequisite warns about dependents
- **GIVEN** both `inbox.view` and `inbox.reply` are enabled
- **WHEN** the user unchecks `inbox.view`
- **THEN** the UI SHALL prompt confirmation naming `inbox.reply` as a permission that will also be disabled

### Requirement: Implied Permission Is Explained, Not Editable
Permissions that trigger `implies` SHALL show a read-only informational affordance (e.g. an info icon with `title` text) explaining the implied dependency. Implied permissions SHALL NOT appear as editable checkboxes.

#### Scenario: Implied dependency is surfaced read-only
- **GIVEN** `case.assign` implies `agent.view`
- **WHEN** the `case.assign` row renders in the settings UI
- **THEN** it SHALL show a read-only hint that enabling it also requires 檢視人員, handled automatically
- **AND** `agent.view` SHALL NOT appear as a separate editable checkbox solely due to this implication

### Requirement: Locked and Restricted Cells Are Visually Distinct
The settings UI SHALL visually distinguish and disable cells the user cannot change: (a) permissions exceeding the editor's own effective set (privilege-escalation guard), (b) locked core permissions of the `admin` system role, and (c) the `role.manage` permission on the editor's own current role. Each SHALL be non-interactive and SHALL provide an explanatory `title`.

#### Scenario: Permission beyond editor's own set is disabled
- **GIVEN** the editor does not hold `channel.delete`
- **WHEN** the permission list for a role renders
- **THEN** the `channel.delete` checkbox SHALL be disabled with a title explaining the editor cannot grant a permission they lack

#### Scenario: Admin locked core permission cannot be unchecked
- **GIVEN** the `admin` system role is selected and `role.manage` is a locked core permission
- **WHEN** its row renders
- **THEN** the checkbox SHALL be checked, disabled, and marked with a lock affordance

### Requirement: Buffered Save with Explicit Confirmation
The settings UI SHALL buffer permission changes locally and persist them only on an explicit save action. While unsaved changes exist, a persistent save/discard affordance SHALL be shown. On success it SHALL show an inline success message; on failure it SHALL show an inline error and retain the unsaved changes.

#### Scenario: Changes are buffered until save
- **GIVEN** the user toggles several permissions
- **WHEN** no save action has been taken
- **THEN** no permission-assignment API request SHALL have been sent
- **AND** an unsaved-changes indicator with save and discard controls SHALL be visible

#### Scenario: Save persists and confirms
- **GIVEN** unsaved permission changes exist
- **WHEN** the user activates save and the request succeeds
- **THEN** the changes SHALL be persisted and an inline success message SHALL be shown

### Requirement: Frontend Reflects Own Permission for Page Access
Access to the role and permission settings page and its controls SHALL be gated in the frontend by the current user's own permissions: `role.view` to open the page, `role.manage` to edit. Without `role.manage`, the page SHALL render read-only.

#### Scenario: Viewer without role.manage sees read-only page
- **GIVEN** the current user holds `role.view` but not `role.manage`
- **WHEN** the role settings page renders
- **THEN** all permission checkboxes and role edit controls SHALL be disabled (read-only)

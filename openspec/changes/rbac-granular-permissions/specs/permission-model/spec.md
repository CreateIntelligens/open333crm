## ADDED Requirements

### Requirement: Permission Registry as Single Source of Truth
The system SHALL define all permission points in a single in-code registry (`PERMISSIONS`), exported from a shared RBAC module. Each permission point SHALL be an object with fields: `code` (string, unique), `group` (string), `label` (string), `description` (string), optional `dependsOn` (string[]), and optional `implies` (string[]). Permission points SHALL NOT be stored in the database; only role-to-permission assignments are persisted.

#### Scenario: Registry is the authority for available permissions
- **WHEN** the system needs the list of all assignable permissions
- **THEN** it SHALL read from the in-code `PERMISSIONS` registry, not from the database

#### Scenario: Every registry entry has required fields
- **WHEN** the registry is loaded at startup
- **THEN** every entry SHALL have a non-empty `code`, `group`, and `label`
- **AND** startup SHALL fail with a descriptive error if any entry is missing a required field

### Requirement: Permission Code Naming Convention
Permission codes SHALL follow the `resource.action` format using lowercase kebab-case for the resource segment. The action segment SHALL be one of the CRUD verbs (`view`, `create`, `update`, `delete`) or an explicit capability verb (e.g. `assign`, `export`, `send`, `manage`). Codes SHALL be globally unique across the registry.

#### Scenario: Valid permission code
- **WHEN** a permission code `channel.create` is registered
- **THEN** it SHALL be accepted as a valid code

#### Scenario: Duplicate code rejected
- **WHEN** two registry entries declare the same `code`
- **THEN** startup SHALL fail with an error naming the duplicated code

### Requirement: Permission Grouping
Every permission point SHALL belong to exactly one `group` that identifies its functional domain (e.g. `inbox`, `case`, `channel-management`, `marketing`, `analytics`, `system-settings`). Groups SHALL be used for UI sectioning and batch (whole-group) enable operations. Grouping SHALL NOT affect authorization decisions.

#### Scenario: Permissions are grouped for display
- **WHEN** the permission matrix UI requests permissions
- **THEN** permissions SHALL be returned grouped by their `group` field

#### Scenario: Grouping does not affect authorization
- **GIVEN** a role has permission `channel.create` but not other permissions in the `channel-management` group
- **WHEN** an authorization check runs for `channel.create`
- **THEN** the check SHALL pass regardless of other permissions in the same group

### Requirement: Permission Dependency (dependsOn)
A permission point MAY declare `dependsOn` listing other permission codes that are prerequisites within the same functional flow. `dependsOn` relationships SHALL be enforced at assignment time: a role MUST NOT hold a permission without also holding all of its `dependsOn` prerequisites. `dependsOn` prerequisites ARE persisted as explicit RolePermission rows and ARE visible in the settings UI.

#### Scenario: Granting a dependent permission requires its prerequisite
- **GIVEN** `inbox.reply` declares `dependsOn: ['inbox.view']`
- **WHEN** an attempt is made to assign `inbox.reply` to a role that does not hold `inbox.view`
- **THEN** the assignment SHALL be rejected unless `inbox.view` is also granted in the same operation

#### Scenario: Removing a prerequisite cascades
- **GIVEN** a role holds both `inbox.view` and `inbox.reply`
- **WHEN** `inbox.view` is removed from the role
- **THEN** `inbox.reply` SHALL also be removed to avoid a contradictory assignment

### Requirement: Implied Cross-Module Permission (implies)
A permission point MAY declare `implies` listing permission codes from other functional modules that its implementation depends on at runtime. `implies` relationships SHALL be resolved at permission-check time by automatically adding the implied codes to the agent's effective permission set. Implied permissions SHALL NOT be persisted as RolePermission rows and SHALL NOT be shown in the settings UI.

#### Scenario: Implied permission is granted at check time
- **GIVEN** `case.assign` declares `implies: ['agent.view']`
- **AND** a role holds `case.assign` but does not explicitly hold `agent.view`
- **WHEN** the agent's effective permission set is resolved
- **THEN** the set SHALL include both `case.assign` and `agent.view`

#### Scenario: Implied permission is not persisted
- **GIVEN** a role is granted `case.assign` which implies `agent.view`
- **WHEN** the role's stored RolePermission rows are inspected
- **THEN** they SHALL contain `case.assign` but SHALL NOT contain an `agent.view` row solely due to the implication

### Requirement: dependsOn versus implies Distinction
The registry SHALL use `dependsOn` for user-managed prerequisites within the same functional flow (persisted, UI-visible) and `implies` for implementation-level cross-module coupling that users should not manage (not persisted, resolved at check time). A relationship SHALL NOT be declared as both `dependsOn` and `implies` for the same pair.

#### Scenario: Same pair not declared in both mechanisms
- **WHEN** the registry is validated at startup
- **THEN** startup SHALL fail if any permission declares the same target code in both its `dependsOn` and `implies` lists

### Requirement: Registry Integrity Validation at Startup
The system SHALL validate the permission registry at startup (and in CI). Validation SHALL fail with a descriptive error if: a `code` is duplicated, a `dependsOn` or `implies` target does not exist in the registry, or an `implies` graph contains a cycle.

#### Scenario: Dangling reference rejected
- **GIVEN** a permission declares `dependsOn: ['nonexistent.code']`
- **WHEN** the registry is validated
- **THEN** validation SHALL fail naming the missing code

#### Scenario: implies cycle rejected
- **GIVEN** `a.x` implies `b.y` and `b.y` implies `a.x`
- **WHEN** the registry is validated
- **THEN** validation SHALL fail naming the cyclic codes

### Requirement: Route-to-Registry Consistency Check
The system SHALL verify (at startup or in CI) that every permission code referenced by a `requirePermission(code)` guard exists in the registry. This check is the guardrail that prevents adding a guarded feature without registering its permission.

#### Scenario: Guard references an unregistered code
- **GIVEN** a route uses `requirePermission('newfeature.action')`
- **AND** `newfeature.action` is not present in the registry
- **WHEN** the consistency check runs
- **THEN** it SHALL fail naming the unregistered code and the route

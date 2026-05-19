## ADDED Requirements

### Requirement: Tenant tag CRUD
The system SHALL allow authenticated agents to create, list, update, and delete tenant-owned tags with a name, color, type, scope, and optional description. Tag names SHALL be unique per tenant and scope. Deleting a tag SHALL remove all assignments for that tag across contacts, cases, and conversations before deleting the tag definition.

#### Scenario: Create scoped tag
- **WHEN** an authenticated agent creates a tag with scope `CASE`
- **THEN** the system creates a tenant-owned tag that can be assigned only to cases

#### Scenario: List tenant tags
- **WHEN** an authenticated agent lists tags
- **THEN** the system returns only tags that belong to the agent's tenant

#### Scenario: Reject duplicate tag name within scope
- **WHEN** an authenticated agent creates a second tag with the same name and scope in the same tenant
- **THEN** the system rejects the request and does not create a duplicate tag

#### Scenario: Allow same tag name in different scope
- **WHEN** an authenticated agent creates tags with the same name but different scopes in the same tenant
- **THEN** the system allows both tags because their target scopes are different

#### Scenario: Delete tag removes all assignments
- **WHEN** an authenticated agent deletes a tag that is assigned to contacts, cases, and conversations
- **THEN** the system removes all assignments for that tag and deletes the tag definition

### Requirement: Scoped tag assignment
The system SHALL support assigning and removing tags on contacts, cases, and conversations. Assignment SHALL validate that the target belongs to the authenticated tenant, the tag belongs to the same tenant, and the tag scope matches the target type. Assigning the same tag to the same target more than once SHALL be idempotent and SHALL NOT create duplicate assignments.

#### Scenario: Assign contact tag
- **WHEN** an authenticated agent assigns a `CONTACT` scoped tag to a contact in the same tenant
- **THEN** the system attaches the tag to the contact and returns the assignment with tag details

#### Scenario: Assign case tag
- **WHEN** an authenticated agent assigns a `CASE` scoped tag to a case in the same tenant
- **THEN** the system attaches the tag to the case and returns the assignment with tag details

#### Scenario: Assign conversation tag
- **WHEN** an authenticated agent assigns a `CONVERSATION` scoped tag to a conversation in the same tenant
- **THEN** the system attaches the tag to the conversation and returns the assignment with tag details

#### Scenario: Reject scope mismatch
- **WHEN** an authenticated agent assigns a `CONTACT` scoped tag to a case
- **THEN** the system rejects the request and does not create an assignment

#### Scenario: Reject cross-tenant tag assignment
- **WHEN** an authenticated agent assigns a tag from another tenant to a target in the agent's tenant
- **THEN** the system returns not found and does not create an assignment

#### Scenario: Prevent duplicate assignment
- **WHEN** an authenticated agent assigns a tag that is already attached to the same target
- **THEN** the system returns the existing assignment and does not create a duplicate row

#### Scenario: Remove target tag
- **WHEN** an authenticated agent removes a tag from a target in the same tenant
- **THEN** the system deletes only that target-tag assignment and leaves the tag definition intact

### Requirement: Resource tag APIs
The system SHALL expose authenticated resource-level tag endpoints for contacts, cases, and conversations. Each add endpoint SHALL accept a `tagId`. Each remove endpoint SHALL identify the target resource id and tag id in the URL. Resource detail responses SHALL include the current tags for the resource.

#### Scenario: Contact tag endpoints
- **WHEN** an authenticated agent calls `POST /api/v1/contacts/:id/tags` or `DELETE /api/v1/contacts/:id/tags/:tagId`
- **THEN** the system adds or removes the contact tag using tenant and scope validation

#### Scenario: Case tag endpoints
- **WHEN** an authenticated agent calls `POST /api/v1/cases/:id/tags` or `DELETE /api/v1/cases/:id/tags/:tagId`
- **THEN** the system adds or removes the case tag using tenant and scope validation

#### Scenario: Conversation tag endpoints
- **WHEN** an authenticated agent calls `POST /api/v1/conversations/:id/tags` or `DELETE /api/v1/conversations/:id/tags/:tagId`
- **THEN** the system adds or removes the conversation tag using tenant and scope validation

#### Scenario: Resource detail includes tags
- **WHEN** an authenticated agent retrieves a contact, case, or conversation detail
- **THEN** the response includes the current tags for that resource with tag id, name, color, type, and scope

### Requirement: Reusable tag management UI
The web dashboard SHALL provide reusable tag controls for contacts, cases, and conversations. The tag picker SHALL show only tags whose scope matches the current target type, SHALL prevent selecting tags already assigned to the target, and SHALL refresh the parent view after successful add or remove.

#### Scenario: Contact detail tag controls
- **WHEN** a user opens a contact detail surface
- **THEN** the user can view, add, and remove `CONTACT` scoped tags for that contact

#### Scenario: Case detail tag controls
- **WHEN** a user opens a case detail surface
- **THEN** the user can view, add, and remove `CASE` scoped tags for that case

#### Scenario: Conversation tag controls
- **WHEN** a user opens a conversation detail or inbox surface
- **THEN** the user can view, add, and remove `CONVERSATION` scoped tags for that conversation

#### Scenario: Tag picker filters by scope
- **WHEN** the tag picker is opened for a case
- **THEN** the picker lists case-scoped tags and excludes contact-scoped and conversation-scoped tags

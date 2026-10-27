## Purpose

提供由平台管理員逐租戶控制的 AI 文字去識別化功能，讓預設關閉的租戶能在平台啟用後，於資料送往模型前統一遮罩個資，並在處理失敗時停止該次模型呼叫以維持政策。

## ADDED Requirements

### Requirement: Platform controls tenant AI privacy

The system SHALL default AI input de-identification to off for every tenant. Only authenticated platform superusers with a completed password change SHALL read or change this policy through GET/PATCH `/api/v1/platform/tenants/:id/ai-privacy`. PATCH SHALL accept only a boolean `enabled`, validate the tenant, and persist an audit record atomically with the setting. Tenant APIs SHALL offer no override.

#### Scenario: Default off and isolated tenants
- **WHEN** a platform administrator reads an unset policy or enables the policy for tenant A
- **THEN** the unset policy is off, tenant A becomes enabled, and tenant B remains off

#### Scenario: Authorized enable and disable
- **WHEN** a platform administrator sets `enabled` to true and later false for an existing tenant
- **THEN** each change persists with an audit record identifying the actor, tenant and boolean setting

#### Scenario: Rejected administrative requests
- **WHEN** a request lacks platform authorization, requires a password change, targets an unknown tenant, or contains a non-boolean or extra field
- **THEN** it is rejected with the corresponding 401, 403, 404 or 400 response and no setting is changed

### Requirement: Mask AI text before model dispatch

When enabled, the system SHALL apply full category-label masking through 2md to Chat prompts, current messages, history and assembled context, Agent messages including nested tool arguments and tool results before every model turn, and Embedding input. Credentials and transport configuration SHALL remain outside the masking request. When off, text SHALL pass through unchanged with no de-identification request.

#### Scenario: Disabled AI call
- **WHEN** the tenant policy is off and a Chat, Agent or Embedding call is made
- **THEN** the original input reaches its model and no de-identification request is made

#### Scenario: Enabled Chat and Embedding calls
- **WHEN** the policy is enabled and Chat context or Embedding input contains personal information
- **THEN** only the returned masked text reaches the model and the original caller-owned input stays unchanged

#### Scenario: Agent tool result and arguments
- **WHEN** an enabled Agent makes a subsequent turn containing tool results and nested string arguments
- **THEN** the text and argument values are masked before model dispatch while tool names, call identifiers and non-string values retain their protocol meaning

### Requirement: Store a protected representation for every message content

When enabled, the system SHALL de-identify every textual `Message.content` payload before it is persisted, including inbound channel events, agent and automation messages, and agent-authored outbound messages. It SHALL store a masked representation alongside the message without storing upstream mappings, CSV or score data. Model, summary, cross-channel context and embedding reads SHALL prefer that masked representation.

#### Scenario: Inbound channel message keeps an operational original
- **WHEN** a channel delivers a text message containing personal information to an enabled tenant
- **THEN** the CRM stores the original message for authorized customer-service work, stores its masked representation with the message, and all later model-facing reads use the masked representation

#### Scenario: System-created message is protected
- **WHEN** an enabled tenant creates a Bot, Agent, automation or system text message whose text comes from a model, an automation summary or an agent
- **THEN** the message write stores and delivers the masked content, and no model-facing read uses the original content

#### Scenario: Masking storage failure preserves no unclassified model path
- **WHEN** the de-identification service fails while an enabled tenant writes a message
- **THEN** the write reports a bounded privacy-processing failure before downstream model work can consume the raw content

### Requirement: Fixed system wording keeps its authored text

When enabled, the system SHALL deliver and store fixed system wording that its code composes as authored, including inserted links and names, and SHALL store its masked copy in message metadata with mode `system_template` for model-facing reads. Text that comes from a model, a knowledge-base reply, an automation summary or an agent SHALL keep its masked delivery and storage.

#### Scenario: System template message keeps its authored text
- **WHEN** an enabled tenant sends or records fixed system wording, such as an email or phone registration link, an account-binding notice, a CSAT survey or follow-up, the default handoff notice, a return-to-bot note or a binding-failure note
- **THEN** the customer receives and the conversation stores the authored text, including inserted links and names, a masked copy is stored for model-facing reads, and the mode is `system_template`

#### Scenario: Agent-typed handoff notice stays masked
- **WHEN** an enabled tenant hands a conversation to an agent with a handoff notice that the agent typed
- **THEN** the customer receives and the conversation stores the masked notice

### Requirement: Tenant-authored automatic wording keeps its authored text

When enabled, the system SHALL deliver and store wording that a tenant wrote in advance and the system sends automatically as authored, including customer variables rendered into it, and SHALL store its masked copy in message metadata with mode `tenant_template` for model-facing reads. Saved marketing material keeps its own masking rule.

#### Scenario: Outside-hours reply keeps its authored text
- **WHEN** an enabled tenant's customer writes outside office hours and the tenant's outside-hours reply is sent
- **THEN** the customer receives and the conversation stores the authored reply, and a masked copy is stored with mode `tenant_template`

#### Scenario: First-contact greeting with customer variables
- **WHEN** an enabled tenant sends a first-contact greeting that renders the customer's name, phone and email
- **THEN** that customer receives and the conversation stores the rendered text, and every model-facing read uses the masked copy without those values

#### Scenario: Canvas message node keeps its authored text
- **WHEN** an enabled tenant's Canvas flow reaches a message node with text
- **THEN** the customer receives and the conversation stores the node text as authored, with a masked copy for model-facing reads

#### Scenario: Masking failure on tenant-authored wording
- **WHEN** the de-identification service fails while an outside-hours reply, first-contact greeting or Canvas message is prepared
- **THEN** that message is neither stored nor sent, as for other message writes

### Requirement: Agent chooses the outbound content representation

When an enabled tenant's agent composes a text reply, the message composer SHALL default to masked delivery and storage. The agent SHALL be able to explicitly select original delivery for that one message. Both choices SHALL persist a masked representation for later model-facing reads and shall clearly identify the selected representation in message metadata.

#### Scenario: Default masked agent reply
- **WHEN** an agent sends a text reply without changing the privacy control
- **THEN** the CRM stores and delivers the masked content and records that masking was applied by default

#### Scenario: Agent preserves original reply
- **WHEN** an agent explicitly chooses to preserve original content before sending a text reply
- **THEN** the CRM stores and delivers the original content, stores the masked representation alongside it, and records the explicit choice

#### Scenario: Disabled policy does not add a forced mask
- **WHEN** the policy is off and an agent sends a text reply
- **THEN** the CRM stores and delivers the authored content without a de-identification request or privacy override control

### Requirement: Protect saved marketing material content

When enabled, material create and body update SHALL de-identify all textual `body` values before persistence. The default mode stores the masked body for delivery. Explicit original mode keeps the authored body for delivery and stores its masked copy. Each version snapshot SHALL save the selected body, masked copy and mode. When disabled, body writes SHALL remain unchanged without a de-identification request.

#### Scenario: New material defaults to masked content
- **WHEN** an enabled tenant creates a material containing personal information without selecting original mode
- **THEN** `Material.body` and its initial version contain the masked text and the selected mode is `mask`

#### Scenario: Editor explicitly preserves material original
- **WHEN** an enabled tenant creates or edits a material with original mode selected
- **THEN** `Material.body` retains the authored text, `maskedBody` and the version snapshot contain the masked text, and the selected mode is `original`

#### Scenario: Material update refreshes the protected snapshot
- **WHEN** an enabled tenant edits a material body without selecting original mode
- **THEN** the saved body and new version snapshot contain masked text, replacing any prior masked representation

#### Scenario: Material masking failure prevents persistence
- **WHEN** the de-identification service fails while a material is created or its body is updated
- **THEN** the operation fails with a bounded privacy-processing error and no material or version write occurs

#### Scenario: Disabled policy preserves material behavior
- **WHEN** the policy is off and a material is created or edited
- **THEN** the authored body is saved unchanged and no privacy sidecar or de-identification request is added

### Requirement: Fail closed on privacy processing failure

The system SHALL stop model dispatch when policy loading fails, a stored policy is invalid, or de-identification fails, times out, returns an invalid payload or exceeds configured size limits. Errors SHALL use a bounded message without upstream response bodies or customer input. It SHALL never retry the same model request with its original text as a privacy fallback.

#### Scenario: Privacy service unavailable
- **WHEN** an enabled call encounters HTTP, network, timeout, malformed response or input/output size failure
- **THEN** the model is not called and the reported failure contains no submitted personal data

#### Scenario: Agent trace masking failure
- **WHEN** the de-identification service fails while an Agent stores a tool trace or final output
- **THEN** the run is marked failed with a fixed reason, the raw trace is not persisted, and no later model turn is dispatched

#### Scenario: Policy unavailable
- **WHEN** policy storage fails or contains a malformed value
- **THEN** model dispatch stops rather than treating the tenant as disabled

### Requirement: Discard restoration mapping

The system SHALL consume only the de-identified text from the upstream response. It SHALL exclude upstream mappings, CSV, original values and privacy scores from model requests, stored traces and logs. It SHALL retain no shared text cache across tenants or runs, and SHALL preserve original CRM records rather than rewriting them as part of model input processing.

#### Scenario: Mapping remains outside model input
- **WHEN** 2md returns masked text together with original values in mapping and CSV fields
- **THEN** only masked text is used downstream and no mapping or CSV is logged or persisted

### Requirement: Platform UI reflects persisted privacy policy

The platform tenant detail page SHALL show the persisted policy and permit administrators to enable or disable it. The control SHALL stay disabled while loading or saving, display actionable errors, and preserve the last confirmed state after a failed save. It SHALL explain external original-text processing, tenant enforcement, model-call blocking and the original CRM record retention scope.

#### Scenario: Display and update privacy setting
- **WHEN** an administrator loads the tenant detail page and changes the privacy control
- **THEN** the control reflects the server value and updates its confirmed value only after a successful save

#### Scenario: Failed privacy setting request
- **WHEN** loading or saving the privacy policy fails
- **THEN** the UI reports the failure, offers a retry for failed loading, and preserves the confirmed value after failed saving

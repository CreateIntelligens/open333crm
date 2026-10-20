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

### Requirement: Fail closed on privacy processing failure

The system SHALL stop model dispatch when policy loading fails, a stored policy is invalid, or de-identification fails, times out, returns an invalid payload or exceeds configured size limits. Errors SHALL use a bounded message without upstream response bodies or customer input. It SHALL never retry the same model request with its original text as a privacy fallback.

#### Scenario: Privacy service unavailable
- **WHEN** an enabled call encounters HTTP, network, timeout, malformed response or input/output size failure
- **THEN** the model is not called and the reported failure contains no submitted personal data

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

## ADDED Requirements

### Requirement: AI-Generated Flex Draft From Prompt

The system SHALL let a user describe a desired card in one sentence and receive an AI-generated LINE Flex bubble draft, which then loads into the template fill-in editor for refinement. The generated Flex SHALL be validated against LINE's validate API before being accepted; if invalid, the system SHALL attempt one correction (feeding the LINE error back to the model) and, failing that, return an error suggesting the user start from a template. AI generation SHALL consume the tenant's AI token quota (never bypassing the quota enforcement) and use the tenant's AI key.

#### Scenario: Generate a Flex draft from a description

- **WHEN** a user enters "母親節康乃馨優惠券，粉色系，含使用期限" and requests AI generation
- **THEN** the system returns a valid Flex bubble draft loaded into the fill-in editor

#### Scenario: Invalid AI output is corrected or rejected

- **WHEN** the AI returns Flex that fails LINE validation
- **THEN** the system retries once with the error fed back, and if still invalid returns an error suggesting a template — it never loads invalid Flex

#### Scenario: Generation respects token quota

- **WHEN** the tenant's AI token quota is exhausted
- **THEN** AI generation is blocked by the existing quota enforcement

#### Scenario: No AI key disables the entry

- **WHEN** the tenant has no AI key configured
- **THEN** the AI-generate entry is disabled with a prompt to configure it, and template fill-in still works

### Requirement: AI Text Rewrite in Fill-in Editor

Text fields in the fill-in editor SHALL offer AI rewrite actions (polish / shorten / tone adjustment) that call the LLM and replace the field content, consuming the tenant's token quota.

#### Scenario: Polish a text field

- **WHEN** a user clicks "AI 潤稿" on the title field
- **THEN** the field content is rewritten by the LLM and the preview updates

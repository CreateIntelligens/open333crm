## ADDED Requirements

### Requirement: Handoff prompt configurable per channel
The system SHALL store the handoff-to-human prompt configuration in `Channel.settings.botConfig` JSON with three fields: `handoffPromptEnabled` (boolean, default `true`), `handoffPromptStyle` (`'text' | 'button' | 'both' | 'none'`, default `'button'`), and `handoffButtonLabel` (string, default `'💬 轉接客服'`).

#### Scenario: Channel without botConfig fields
- **WHEN** a Channel has no `handoffPromptEnabled` / `handoffPromptStyle` / `handoffButtonLabel` in its `settings.botConfig`
- **THEN** the system SHALL fall back to defaults `true` / `'button'` / `'💬 轉接客服'`

#### Scenario: Admin updates botConfig via settings
- **WHEN** an admin saves new `handoffPromptStyle: 'none'` via the channel settings UI
- **THEN** the value is persisted to `Channel.settings.botConfig.handoffPromptStyle` and takes effect on the next inbound message

### Requirement: KB auto-reply attaches handoff prompt per botConfig
The system SHALL, when sending a KB auto-reply with reply kind `kb_with_handoff` (similarity between `clarifyThreshold` and `0.80`), read the channel's `botConfig.handoffPromptStyle` and attach the handoff prompt accordingly. The hardcoded `HANDOFF_PROMPT` constant in `kb-autoreply.service.ts` SHALL be removed; the default text used when style is `'text'` or `'both'` lives in the BotConfig defaults.

#### Scenario: Style is button (default)
- **WHEN** a KB auto-reply triggers with `kb_with_handoff` and `botConfig.handoffPromptStyle === 'button'`
- **THEN** the outbound message SHALL NOT contain the handoff text and SHALL include a quick reply item with `label = handoffButtonLabel` and `postbackData = 'handoff_request'`

#### Scenario: Style is text
- **WHEN** a KB auto-reply triggers with `kb_with_handoff` and `botConfig.handoffPromptStyle === 'text'`
- **THEN** the outbound message text SHALL be `<llmReply>\n\n<defaultHandoffPromptText>` and SHALL NOT include the handoff quick reply

#### Scenario: Style is both
- **WHEN** a KB auto-reply triggers with `kb_with_handoff` and `botConfig.handoffPromptStyle === 'both'`
- **THEN** the outbound message SHALL include both the text suffix AND the quick reply button

#### Scenario: Style is none
- **WHEN** a KB auto-reply triggers with `kb_with_handoff` and `botConfig.handoffPromptStyle === 'none'`
- **THEN** the outbound message SHALL contain only the LLM reply, no text suffix, no quick reply

#### Scenario: Prompt disabled
- **WHEN** `botConfig.handoffPromptEnabled === false`
- **THEN** the outbound message SHALL contain only the LLM reply regardless of `handoffPromptStyle` value

#### Scenario: KB high confidence reply (sim >= 0.80)
- **WHEN** a KB auto-reply triggers with reply kind `kb_high_confidence`
- **THEN** no handoff prompt SHALL be attached (button or text), regardless of botConfig — `kb_high_confidence` already represents a confident answer

### Requirement: Webhook intercepts handoff_request postback
The system SHALL intercept LINE postback events with data `handoff_request` in `webhook.service.ts` and treat them as an explicit user request to escalate to a human agent. The interception SHALL occur after CSAT and `kb_feedback` interception, and SHALL `return` early without publishing the `message.received` event (avoiding accidental automation re-triggers, same pattern as CSAT / kb_feedback).

#### Scenario: User taps the handoff quick reply
- **WHEN** the webhook receives a postback with `data === 'handoff_request'` on a conversation in `BOT_HANDLED` status
- **THEN** the system SHALL update the conversation `status` to `'AGENT_HANDLED'` with `handoffReason: 'user_requested_handoff'`
- **AND** the system SHALL send the channel `botConfig.handoffMessage` (default `'稍等，正在為您轉接客服人員'`) to the user
- **AND** the system SHALL publish a `conversation.handoff` eventBus event so SUPERVISOR/ADMIN are notified
- **AND** the system SHALL NOT publish `message.received` (no automation re-trigger)

#### Scenario: handoff_request on already AGENT_HANDLED conversation
- **WHEN** the webhook receives `handoff_request` on a conversation already in `AGENT_HANDLED` status
- **THEN** the system SHALL idempotently respond with the handoffMessage (no DB status change) and SHALL NOT republish the handoff event

### Requirement: BotConfig form exposes handoff prompt fields
The system SHALL expose the three new botConfig fields in the admin `BotConfigForm.tsx` UI: a boolean toggle for `handoffPromptEnabled`, a radio group for `handoffPromptStyle` (4 options), and a text input for `handoffButtonLabel`. The UI SHALL display helper text explaining that when style is `'none'`, users can still trigger handoff by typing keywords (`handoffKeywords`).

#### Scenario: Admin opens BotConfig settings
- **WHEN** an admin opens a LINE channel's BotConfig dialog
- **THEN** the UI SHALL display all three new fields with the channel's current values (or defaults if unset)

#### Scenario: Admin saves with style = none
- **WHEN** an admin sets `handoffPromptStyle: 'none'` and saves
- **THEN** the UI SHALL show a hint that the user can still type `handoffKeywords` (`真人` / `客服` / ...) to trigger handoff

### Requirement: Existing handoffKeywords path remains active
The system SHALL retain the existing `handoffKeywords` detection logic in `checkAutoHandoff`. Users who type any configured keyword in `botConfig.handoffKeywords` SHALL be auto-handed off regardless of the new `handoffPromptEnabled` / `handoffPromptStyle` settings.

#### Scenario: User types keyword while prompt is disabled
- **WHEN** `handoffPromptEnabled === false` (no prompt shown) and the user types `真人`
- **THEN** the conversation SHALL still be auto-handed off via the existing `checkAutoHandoff` keyword path

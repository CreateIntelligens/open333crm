## ADDED Requirements

### Requirement: Identity binding intercept precedes greeting and automation
When the tenant has identity binding enabled, inbound processing SHALL check each inbound event for a binding keyword, a binding code (in text, or in a FB/IG referral `ref`), or an unbind keyword **before** the first-contact greeting runs. When one matches, the system SHALL handle it, SHALL NOT send the first-contact greeting, SHALL NOT run the other postback interceptors, and SHALL NOT publish `message.received`; it SHALL still emit the inbound socket events so agents see the message in the inbox.

#### Scenario: New LINE friend sends a binding code
- **WHEN** a first-time LINE user sends a message containing a valid binding code
- **THEN** the system SHALL merge the contacts, SHALL NOT send the first-contact greeting, SHALL NOT trigger AI reply or keyword rules, and the message SHALL appear in the inbox

#### Scenario: Binding disabled
- **WHEN** identity binding is disabled for the tenant
- **THEN** inbound processing SHALL behave exactly as before this change

### Requirement: FB and Instagram referral events are parsed
The FB and Instagram channel plugins SHALL parse referral events (FB `messaging_referrals`, standalone `referral`, and `referral` nested in `message` or `postback`; Instagram `messaging_referral` for existing threads, and `referral` nested in the first `messages` or `messaging_postback` event of a new thread) and expose the `ref` value on the parsed event as `referralRef`. A referral-only event whose `ref` is not a binding code SHALL be logged and SHALL NOT create an inbox message.

#### Scenario: m.me link with ref
- **WHEN** FB delivers a `referral` event with `ref = BIND-7K2M9QH4TX` and source `SHORTLINK`
- **THEN** the parsed event SHALL have `referralRef = "BIND-7K2M9QH4TX"` and be processed by the identity binding intercept

#### Scenario: Unrelated referral
- **WHEN** FB delivers a referral event from an ad with `ref = spring_sale`
- **THEN** the system SHALL log it and SHALL NOT create a message in the inbox

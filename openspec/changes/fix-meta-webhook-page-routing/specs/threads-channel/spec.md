## ADDED Requirements

### Requirement: Instagram account ID uses user_id
Instagram channel verification SHALL request `/me?fields=user_id,username` and store `user_id` (the Instagram professional account ID, equal to webhook `entry.id`) as the channel's external account ID. The app-scoped `id` field SHALL NOT be used for routing.

#### Scenario: Verify Instagram channel
- **WHEN** an Instagram channel is verified and Graph returns `id = 1789…app-scoped` and `user_id = 1784…`
- **THEN** the channel's external account ID SHALL be `1784…`

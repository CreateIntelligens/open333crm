## ADDED Requirements

### Requirement: Admin can configure chatbox background image
The system SHALL allow authenticated tenant admins or supervisors to configure a background image for a WEBCHAT chatbox using tenant-owned storage assets.

#### Scenario: Upload background image
- **WHEN** an authorized user uploads a valid image for a WEBCHAT channel background
- **THEN** the system stores the image as a tenant-owned asset and saves a reference in the WEBCHAT channel settings

#### Scenario: Reject unauthorized theme update
- **WHEN** an unauthorized agent attempts to update the chatbox background image
- **THEN** the system rejects the request and does not change channel settings

#### Scenario: Reject asset from another tenant
- **WHEN** a user attempts to configure a background image asset owned by another tenant
- **THEN** the system rejects the request and does not expose that asset in public chatbox config

### Requirement: Public chatbox config exposes safe theme values
The public chatbox bootstrap SHALL expose only sanitized theme values required for rendering, including public-safe background image URL, background mode, and overlay option.

#### Scenario: Visitor loads themed chatbox
- **WHEN** a visitor opens a valid chatbox session for a channel with a configured background image
- **THEN** the bootstrap config includes the public-safe background image URL and rendering options

#### Scenario: No background image configured
- **WHEN** a visitor opens a chatbox session for a channel without a background image
- **THEN** the chatbox uses the default background style

### Requirement: Chatbox theme remains channel-scoped
The system SHALL store chatbox theme configuration on the WEBCHAT channel settings and SHALL apply it only to chatbox sessions for that channel.

#### Scenario: Channel-specific background
- **WHEN** two WEBCHAT channels have different background image settings
- **THEN** each chatbox session receives only the theme for its own channel

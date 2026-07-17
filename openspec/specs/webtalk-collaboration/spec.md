## Purpose

WebTalk collaboration defines how the Open333CRM dashboard loads, mounts, and cleans up the external WebTalk multi-user chat SDK for authenticated operators.

## Requirements

### Requirement: Authenticated Global WebTalk Loading
The system SHALL load and mount WebTalk globally for authenticated dashboard users.

#### Scenario: Authenticated agent enters dashboard
- **WHEN** a dashboard user has an authenticated agent session
- **THEN** the dashboard shell loads and mounts WebTalk globally
- **AND** unauthenticated users remain subject to the existing dashboard authentication redirect

#### Scenario: Dashboard navigation does not expose WebTalk page
- **WHEN** an authenticated dashboard user views the sidebar navigation
- **THEN** the navigation does not include a dedicated WebTalk tab or route entry

### Requirement: WebTalk SDK Loading
The system SHALL load the WebTalk SDK script after dashboard authentication with auto-mount disabled and the configured AI endpoint.

#### Scenario: WebTalk script is inserted with required attributes
- **WHEN** the authenticated dashboard shell mounts in the browser
- **THEN** the page loads `https://webtalk-nine.vercel.app/webtalk.js`
- **AND** the script has `data-webtalk-auto-mount="false"`
- **AND** the script has `data-webtalk-ai-endpoint="https://webtalk-nine.vercel.app/api/webtalk/ai"`

#### Scenario: WebTalk script is not duplicated
- **WHEN** the authenticated dashboard shell is mounted more than once during client-side navigation
- **THEN** the browser document contains at most one WebTalk SDK script for the configured source

### Requirement: WebTalk Mount Lifecycle
The system SHALL mount and unmount WebTalk using the SDK lifecycle methods.

#### Scenario: WebTalk mounts after SDK readiness
- **WHEN** the WebTalk SDK has loaded in the authenticated dashboard shell
- **THEN** the page calls `window.WebTalk.mount`
- **AND** the mount options include `scope: 'origin'`
- **AND** the mount options include `siteId: 'open333crm-uat'`
- **AND** the mount options include `enableVirtualRoom: false`

#### Scenario: WebTalk unmounts when leaving authenticated dashboard
- **WHEN** the authenticated dashboard shell unmounts because the user leaves the dashboard
- **THEN** the page calls `window.WebTalk.unmount()` if the SDK is available

#### Scenario: WebTalk unmounts during logout
- **WHEN** an authenticated user logs out
- **THEN** the logout flow calls `window.WebTalk.unmount()` if the SDK is available before leaving the dashboard session

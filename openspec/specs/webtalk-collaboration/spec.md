## Purpose

WebTalk collaboration defines how the Open333CRM dashboard loads, mounts, and cleans up the external WebTalk multi-user chat SDK for authenticated operators, how the API issues a tenant-isolated room to each tenant, and which tenant settings control WebTalk and its AI summary. WebTalk is an external add-on, not part of the Open333CRM product features, so the user manual does not describe it.

## Requirements

### Requirement: Authenticated Global WebTalk Loading
The system SHALL load and mount WebTalk globally for an authenticated dashboard user only when `GET /api/v1/webtalk/session` returns `enabled: true` for that user. When the session returns `enabled: false` or the request fails, the dashboard MUST NOT insert the WebTalk SDK script.

#### Scenario: Authenticated agent enters dashboard
- **WHEN** a dashboard user has an authenticated agent session and `GET /api/v1/webtalk/session` returns `enabled: true`
- **THEN** the dashboard shell loads and mounts WebTalk globally
- **AND** unauthenticated users remain subject to the existing dashboard authentication redirect

#### Scenario: Dashboard navigation does not expose WebTalk page
- **WHEN** an authenticated dashboard user views the sidebar navigation
- **THEN** the navigation does not include a dedicated WebTalk chat tab or route entry
- **AND** the only WebTalk entry is the settings section `/dashboard/settings/webtalk`, shown to users with `settings.manage`

#### Scenario: WebTalk is disabled for the tenant or not configured
- **WHEN** `GET /api/v1/webtalk/session` returns `enabled: false` (reason `TENANT_DISABLED` or `NOT_CONFIGURED`)
- **THEN** the document contains no WebTalk SDK script
- **AND** `window.WebTalk.mount` is not called

### Requirement: WebTalk SDK Loading
The system SHALL load the WebTalk SDK from the `sdkUrl` returned by the session endpoint, with auto-mount disabled. The web app MUST NOT hard-code the SDK URL, the site ID or the AI endpoint.

#### Scenario: WebTalk script is inserted with required attributes
- **WHEN** the session returns `enabled: true` with `sdkUrl` `https://sdk.example.test/webtalk.js`
- **THEN** the page loads a script whose `src` is `https://sdk.example.test/webtalk.js`
- **AND** the script has `data-webtalk-auto-mount="false"`
- **AND** when the session returns a non-empty `sdkIntegrity`, the script has that `integrity` value and `crossorigin="anonymous"`

#### Scenario: WebTalk script is not duplicated
- **WHEN** the authenticated dashboard shell is mounted more than once during client-side navigation
- **THEN** the browser document contains at most one WebTalk SDK script

### Requirement: WebTalk Mount Lifecycle
The system SHALL mount WebTalk with the room ID issued by the API and SHALL unmount it when the operator leaves the dashboard, switches account or logs out. Mount options MUST NOT contain `scope` or `siteId`, so that the SDK cannot derive a shared room from the page origin.

#### Scenario: WebTalk mounts after SDK readiness
- **WHEN** the WebTalk SDK has loaded and the session returned `roomId` `o333-abc`
- **THEN** the page calls `window.WebTalk.mount` with `roomId: 'o333-abc'`, `enableVirtualRoom: false` and the `aiEndpoint` described in "WebTalk AI Summary Gating"
- **AND** the mount options contain neither `scope` nor `siteId`

#### Scenario: WebTalk unmounts when leaving authenticated dashboard
- **WHEN** the authenticated dashboard shell unmounts because the user leaves the dashboard
- **THEN** the page calls `window.WebTalk.unmount()` if the SDK is available

#### Scenario: WebTalk unmounts during logout
- **WHEN** an authenticated user logs out
- **THEN** the logout flow calls `window.WebTalk.unmount()` if the SDK is available before leaving the dashboard session
- **AND** if the SDK script was loaded in this page, the logout flow navigates to `/login` with a full page load instead of client-side navigation

#### Scenario: WebTalk remounts after the operator changes
- **WHEN** the authenticated agent changes from agent A to agent B in the same page, after the SDK has been mounted and unmounted once
- **THEN** the page fetches a new session for agent B and calls `mount` again with agent B's room ID, even though `unmount()` removed `window.WebTalk`

### Requirement: Tenant-Isolated WebTalk Room Issuance
`GET /api/v1/webtalk/session` SHALL return a room ID derived as HMAC-SHA256 with the server secret `WEBTALK_ROOM_SECRET` over the site ID, the caller's tenant ID and the tenant's room version. The tenant ID MUST come from the authenticated agent, never from request input. The room ID MUST NOT contain the tenant ID in plain text.

#### Scenario: Agents of the same tenant share one room
- **WHEN** two authenticated agents of tenant A request the session
- **THEN** both responses contain the same `roomId`

#### Scenario: Different tenants never share a room
- **WHEN** an agent of tenant A and an agent of tenant B request the session
- **THEN** the two `roomId` values differ
- **AND** neither `roomId` contains a tenant ID

#### Scenario: Unauthenticated request is rejected
- **WHEN** a request without a valid access token calls `GET /api/v1/webtalk/session`
- **THEN** the response is 401 and contains no `roomId`

#### Scenario: Non-human credentials are rejected
- **WHEN** a Partner API key or a CLI session calls `GET /api/v1/webtalk/session`
- **THEN** the response is 403 with error code `FORBIDDEN` and contains no `roomId`

#### Scenario: Missing room secret fails closed
- **WHEN** `WEBTALK_ROOM_SECRET` is unset or shorter than 32 characters, or `WEBTALK_SDK_URL` is unset or not an https URL (except `localhost`)
- **THEN** the session response is `{ enabled: false, reason: 'NOT_CONFIGURED' }` with no `roomId`

#### Scenario: Environments do not share rooms
- **WHEN** the same tenant ID is used with site ID `open333crm-uat` and with site ID `open333crm-prod`
- **THEN** the derived room IDs differ

### Requirement: Tenant WebTalk Settings
The system SHALL store per-tenant WebTalk switches in `TenantSettings`: `webtalkEnabled` (default `true`) and `webtalkAiEnabled` (default `false`). `GET` and `PUT /api/v1/webtalk/settings` MUST require `settings.manage` and MUST only read or write the caller's tenant. When the tenant has no settings row, the defaults apply.

#### Scenario: Defaults without a settings row
- **WHEN** a tenant without a `TenantSettings` row reads `GET /api/v1/webtalk/settings`
- **THEN** the response is `{ enabled: true, aiEnabled: false }`

#### Scenario: Tenant disables WebTalk
- **WHEN** an agent with `settings.manage` sends `PUT /api/v1/webtalk/settings` with `{ enabled: false }`
- **THEN** later session responses for that tenant are `{ enabled: false, reason: 'TENANT_DISABLED' }` with no `roomId`
- **AND** session responses for other tenants are unchanged

#### Scenario: Settings change requires permission
- **WHEN** an agent without `settings.manage` sends `PUT /api/v1/webtalk/settings`
- **THEN** the response is 403 with `error.details.requiredPermission` equal to `settings.manage`
- **AND** the stored settings are unchanged

#### Scenario: Invalid settings body is rejected
- **WHEN** `PUT /api/v1/webtalk/settings` receives `{ enabled: "yes" }`
- **THEN** the response is 400 and the stored settings are unchanged

### Requirement: WebTalk Room Rotation
`POST /api/v1/webtalk/settings/rotate-room` SHALL increase the caller tenant's `webtalkRoomVersion` by one, so that the tenant gets a new room ID and anyone who only knows the old room ID cannot meet the tenant's operators. The endpoint MUST require `settings.manage` and MUST write a tenant audit entry.

#### Scenario: Rotation changes the room ID
- **WHEN** an agent with `settings.manage` calls `POST /api/v1/webtalk/settings/rotate-room`
- **THEN** the next session response for that tenant contains a `roomId` different from the previous one
- **AND** the room ID of other tenants is unchanged

### Requirement: WebTalk AI Summary Gating
The session response SHALL contain `aiEnabled: true` and the configured `aiEndpoint` only when the tenant's `webtalkAiEnabled` is `true` and `WEBTALK_AI_ENDPOINT` is set. Otherwise it MUST return `aiEnabled: false` and `aiEndpoint: null`, and the web app MUST mount the SDK with `aiEndpoint` set to the CRM API endpoint `/api/v1/webtalk/ai-disabled`, so that page content is not sent to an external endpoint.

#### Scenario: AI summary disabled by default
- **WHEN** a tenant with default settings requests the session
- **THEN** the response contains `aiEnabled: false` and `aiEndpoint: null`
- **AND** the web app mounts WebTalk with `aiEndpoint` equal to `<API_BASE_URL>/webtalk/ai-disabled`, where `API_BASE_URL` is the web app's API base ending in `/api/v1`

#### Scenario: AI summary enabled by the tenant
- **WHEN** the tenant sets `aiEnabled: true` and `WEBTALK_AI_ENDPOINT` is `https://ai.example.test/api/webtalk/ai`
- **THEN** the session response contains `aiEnabled: true` and that `aiEndpoint`
- **AND** the web app mounts WebTalk with that `aiEndpoint`

#### Scenario: AI enabled by the tenant but not configured on the server
- **WHEN** the tenant sets `aiEnabled: true` and `WEBTALK_AI_ENDPOINT` is unset
- **THEN** the session response contains `aiEnabled: false` and `aiEndpoint: null`

#### Scenario: Disabled AI endpoint refuses requests
- **WHEN** any client sends `POST /api/v1/webtalk/ai-disabled` with a JSON body
- **THEN** the response is 403 with error code `WEBTALK_AI_DISABLED` and a Traditional Chinese `error.message`

### Requirement: WebTalk Operator Identity
Before mounting, the web app SHALL write the current agent's ID and name into the SDK's user-info storage, so that colleagues see the operator's name instead of a self-chosen nickname. This identity is for display only and MUST NOT be treated as authentication.

#### Scenario: Agent name is shown in WebTalk
- **WHEN** agent `王小明` with ID `a1` enters the dashboard and WebTalk mounts
- **THEN** before `mount` is called, `localStorage['WEB_TALK_WEB:sync:WEB_TALK_USER_INFO']` contains `id: 'a1'` and `name: '王小明'`

### Requirement: WebTalk Local Data Cleanup
When WebTalk unmounts, the web app SHALL remove the SDK's local data: each `localStorage` key that starts with `WEB_TALK_` and each IndexedDB `keyval-store` key that starts with `WEB_TALK_`. Keys of other features MUST be kept.

#### Scenario: Logout removes WebTalk local data
- **WHEN** an operator logs out after using WebTalk
- **THEN** `localStorage` contains no key starting with `WEB_TALK_`
- **AND** keys that do not start with `WEB_TALK_` are unchanged

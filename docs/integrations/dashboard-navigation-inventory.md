# Dashboard Navigation Inventory

This inventory is the route contract for the tree-navigation migration. A
module-level tab becomes a canonical route; tabs that only filter data remain
local to the page.

| Area | Canonical destinations | Legacy/current surface | Navigation decision | Permission |
| --- | --- | --- | --- | --- |
| Inbox | `/dashboard/inbox` | Active/Closed and All/Unread/Mine tabs | Keep local data filters | authenticated |
| Cases | `/dashboard/cases` and `/dashboard/cases/[caseId]` | Status filter tabs | Keep local data filters | authenticated / route guard |
| Contacts | `/dashboard/contacts` and `/dashboard/contacts/[contactId]` | List + detail | Tree leaf + detail child | authenticated |
| Automation | `/dashboard/automation` and `/dashboard/automation/[ruleId]` | List + detail | Tree leaf + detail child | `automation.view` |
| Knowledge Base | `/dashboard/knowledge/articles`, `/search`, `/feedback`, `/embedding`, `/chat-prompt` | Five top-level tabs under `/dashboard/knowledge` | Replace module tabs with tree nodes; `/dashboard/knowledge` defaults to articles | `knowledge.view` |
| Marketing | `/dashboard/marketing/campaigns`, `/broadcasts`, `/segments`, `/materials` | MarketingTabs and `?tab=` state | Replace module tabs with tree nodes; retain legacy query compatibility | `marketing.view` |
| LINE | `/dashboard/line/rich-menus`, `/keyword-replies`, `/quick-replies` and detail/new children | LineModuleTabs | Replace module tabs with tree nodes | `richmenu.manage` |
| Portal | `/dashboard/portal/activities`, `/submissions`, `/points` | Three page tabs | Replace page tabs with tree nodes | `portal.view` |
| Shortlinks | `/dashboard/shortlinks/links`, `/stats` | Two page tabs | Replace page tabs with tree nodes | `shortlink.view` |
| Analytics | `/dashboard/analytics`, `/dashboard/analytics/my` | Report-view tabs and separate My page | Tree destinations for overview/my; report filters stay local | `analytics.view` |
| Plan | `/dashboard/plan` | Global sidebar leaf | Tree leaf | `settings.manage` |
| Settings | `/dashboard/settings/{general,channels,agents,roles,tags,sla,office-hours,tracking,api-keys,cli-sessions,passkeys,a2a}` | Flat local settings state | Replace flat local nav with tree nodes | existing route permissions |
| Notifications | `/dashboard/notifications` | Global notification entry | Tree leaf; no module tab | authenticated |

Detail routes inherit the active state of their parent node. Deprecated or
legacy query URLs must resolve to the canonical destination before the
migration is considered complete.

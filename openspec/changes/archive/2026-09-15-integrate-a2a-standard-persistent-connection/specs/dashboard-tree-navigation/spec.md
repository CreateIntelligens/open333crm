## Purpose

讓 Open333CRM dashboard 的功能入口具備清楚的階層、直接的 URL 與一致的權限呈現，讓使用者不必先猜模組再逐層尋找隱藏在深層 Tabs 的功能。

## ADDED Requirements

### Requirement: Explicit dashboard tree information architecture

The dashboard SHALL expose a single hierarchical tree menu for primary modules and their feature destinations. Every user-facing dashboard route SHALL map to one visible tree node or to an intentional detail-page child of a visible node.

#### Scenario: User opens the dashboard
- **WHEN** an authenticated user enters any dashboard route
- **THEN** the tree SHALL show the active module, expand the relevant ancestor nodes, and provide direct links to the module's primary destinations

#### Scenario: User needs a nested feature
- **WHEN** a feature is currently represented by a module-level tab or a hidden state switch
- **THEN** the feature SHALL be represented by a named tree node with a stable URL and SHALL be reachable without first opening an unrelated default feature

#### Scenario: Detail page is active
- **WHEN** the user opens a nested detail route such as a case, campaign, material, contact, or automation rule
- **THEN** the tree SHALL highlight and expand the correct parent feature without requiring a duplicate detail node for every record

### Requirement: Complete dashboard route inventory

The implementation plan SHALL maintain a route inventory covering the global sidebar, module sub-navigation, settings destinations, detail pages, notifications, plan/billing, and any placeholder or orphaned routes. No existing user-facing route SHALL be silently removed during navigation restructuring.

#### Scenario: Existing route is migrated
- **WHEN** a current route is moved from a tab state to a tree destination
- **THEN** its previous URL SHALL either remain valid or redirect to the new canonical URL, and the feature's user-visible behavior SHALL remain available

#### Scenario: Route has no visible owner
- **WHEN** the inventory finds a route that is not represented in the current sidebar or module navigation
- **THEN** the plan SHALL assign it to a tree group, mark it as intentionally global, or explicitly record it for deprecation before implementation

### Requirement: Navigation tabs and data-filter tabs are distinct

The tree SHALL replace module or feature navigation tabs, but the system MAY retain tabs that filter or compare views within one task context. The distinction SHALL be documented in the route inventory and applied consistently across Knowledge Base, Marketing, LINE, Settings, Inbox, Cases, Analytics, Portal, and Shortlinks.

#### Scenario: Module navigation tab
- **WHEN** tabs switch between independent destinations such as articles, semantic search, embedding settings, or Chat & Prompt
- **THEN** each destination SHALL become a tree node and canonical URL rather than remaining a same-page tab

#### Scenario: Data filtering tab
- **WHEN** tabs only filter the current list or report view, such as inbox status or case status
- **THEN** the tabs MAY remain local to that page and SHALL not be duplicated as global tree nodes

### Requirement: Permission-aware tree rendering

The tree SHALL use the existing permission model to hide or disable destinations the current user cannot access. A hidden destination SHALL also be rejected by the route's existing authorization boundary; navigation visibility SHALL not be treated as authorization.

#### Scenario: User lacks feature permission
- **WHEN** an authenticated user lacks the permission for a tree destination
- **THEN** the destination SHALL not appear as an actionable tree item and direct navigation SHALL return the existing authorization behavior

#### Scenario: User gains access
- **WHEN** the authenticated permission set includes a destination's required permission
- **THEN** the destination SHALL appear in the correct tree position with its active and expanded states working

### Requirement: Responsive and accessible tree interaction

The tree SHALL support keyboard navigation, visible focus, semantic expandable controls, accessible labels, and a compact mobile drawer or equivalent responsive presentation. Expansion state SHALL not prevent access to the active destination on narrow screens.

#### Scenario: Keyboard user navigates the tree
- **WHEN** a user moves through tree items with keyboard input
- **THEN** focus order, expanded/collapsed state, selected state, and activation behavior SHALL be conveyed accessibly without a pointer

#### Scenario: Mobile user opens a nested destination
- **WHEN** a user opens the dashboard on a narrow viewport and selects a nested tree item
- **THEN** the tree SHALL remain usable within the responsive navigation surface, the selected page SHALL open, and the navigation surface SHALL close or yield focus appropriately

### Requirement: Navigation state survives normal browser navigation

Tree destinations SHALL use canonical URLs rather than transient React-only state for primary feature selection. Browser refresh, back/forward navigation, deep links, and copied URLs SHALL restore the same destination and active tree state.

#### Scenario: Refresh a feature URL
- **WHEN** the user refreshes a nested feature URL
- **THEN** the same feature SHALL render directly with the correct expanded tree ancestors

#### Scenario: Browser back navigation
- **WHEN** the user navigates between sibling tree destinations and presses Back
- **THEN** the browser SHALL return to the previous feature without relying on an in-memory tab state

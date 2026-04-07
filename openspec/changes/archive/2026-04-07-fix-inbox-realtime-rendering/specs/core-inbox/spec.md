## MODIFIED Requirements

### Requirement: Inbox Page Conversation Data Fetching
`InboxPage` SHALL use `useSWR` (keyed by `/conversations/:id`) to fetch the selected conversation's details, so that any `globalMutate('/conversations/:id')` call from child components immediately triggers a revalidation and re-render with the latest data.

#### Scenario: Handoff to human agent unlocks message input
- **WHEN** an agent clicks the takeover button and `handleTakeover()` completes successfully
- **THEN** `globalMutate('/conversations/:id')` triggers SWR revalidation in `InboxPage`, the `conversation.status` prop updates to a non-`BOT_HANDLED` value, `isBotHandled` becomes `false`, and the message input box becomes enabled

#### Scenario: Status change reflects immediately in Select
- **WHEN** an agent selects a new status from the status `Select` dropdown and `handleStatusChange()` completes
- **THEN** `globalMutate('/conversations/:id')` triggers SWR revalidation, `conversation.status` updates, and the status `Select` displays the newly selected value

#### Scenario: Agent assignment reflects immediately in Select
- **WHEN** an agent selects a new assignee from the agent `Select` dropdown and `handleAssign()` completes
- **THEN** `globalMutate('/conversations/:id')` triggers SWR revalidation, `conversation.assignedToId` updates, and the agent `Select` displays the newly assigned agent

#### Scenario: No conversation selected
- **WHEN** `convId` is null (no conversation selected)
- **THEN** SWR SHALL NOT issue any API request (null key pattern), and `selectedConversation` SHALL be null

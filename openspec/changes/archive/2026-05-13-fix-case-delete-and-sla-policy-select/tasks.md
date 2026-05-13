## 1. Cases Dashboard

- [x] 1.1 Remove the standalone create-case button from `/dashboard/cases`
- [x] 1.2 Remove unused standalone create-case modal state/imports from the cases page
- [x] 1.3 Add a tenant-scoped delete handler on the cases page that calls `DELETE /cases/:id`
- [x] 1.4 Refresh the cases list and case stats after a successful delete
- [x] 1.5 Add a delete action to `CaseList` that stops row navigation before deleting
- [x] 1.6 Show an error indication when case deletion fails

## 2. Inbox Case Creation SLA Policy

- [x] 2.1 Add `selectedSlaPolicyId` state to `CaseCreateModal`
- [x] 2.2 Bind the SLA policy select value and `onChange` to `selectedSlaPolicyId`
- [x] 2.3 Reset `selectedSlaPolicyId` when the modal form resets
- [x] 2.4 Include the selected SLA policy id in `/cases/from-conversation/:conversationId` payload when non-empty
- [x] 2.5 Include the selected SLA policy id in `/cases` payload when non-empty
- [x] 2.6 Keep the automatic SLA policy option behavior by omitting the field when no policy is selected

## 3. Verification

- [x] 3.1 Add focused source-level or component-level checks for hidden cases create button and delete action wiring
- [x] 3.2 Add focused checks for SLA policy select state and payload inclusion
- [x] 3.3 Run `pnpm --filter @open333crm/web build`
- [x] 3.4 Run any focused tests added for the cases/inbox UI changes

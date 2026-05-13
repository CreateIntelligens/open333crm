## Context

The backend already defines a tenant-scoped case deletion capability, but `/dashboard/cases` currently only lets users navigate into case details and still displays a standalone "建立案件" button that should be hidden. The cases table rows navigate on click, so any delete action must prevent row navigation before calling the delete API.

The inbox create-case modal uses the shared `CaseCreateModal` component. Its SLA policy select currently renders available policies but is not controlled by component state: the select value is hard-coded to an empty string and its `onChange` handler is a no-op. As a result, users cannot select an SLA policy and the selected policy id is never submitted with the create-case request.

## Goals / Non-Goals

**Goals:**
- Add a case delete action to `/dashboard/cases`.
- Refresh the cases list and stats after a successful delete.
- Hide the standalone create-case button on `/dashboard/cases`.
- Keep the inbox create-case entry point available.
- Make the SLA policy dropdown in `CaseCreateModal` controlled and submit the selected policy id.

**Non-Goals:**
- No new Prisma schema changes.
- No change to case deletion semantics beyond using the existing API contract.
- No redesign of the cases table, case detail page, or SLA policy management screen.
- No removal of case creation from `/dashboard/inbox`.

## Decisions

### Decision 1: Delete from the cases table action cell

Add a dedicated action control in `CaseList` for delete. The delete control must call `event.stopPropagation()` so clicking it does not trigger the existing row navigation to `/dashboard/cases/:id`.

Alternative considered: put deletion only on the case detail page. That would not satisfy the request for `/dashboard/cases` to delete directly and would add extra navigation for cleanup workflows.

### Decision 2: Let the cases page own delete side effects

`CasesPage` should pass an `onDelete` handler to `CaseList`. The handler calls `DELETE /cases/:id`, then revalidates the SWR list and stats data. Keeping the API call in the page keeps `CaseList` mostly presentational.

Alternative considered: make `CaseList` call the API directly. This is simpler locally, but it couples the reusable table to a specific mutation and makes list/stat refresh less explicit.

### Decision 3: Remove the standalone create-case entry point from cases page

Hide the Topbar create button and stop mounting the standalone `CaseCreateModal` from `/dashboard/cases`. Inbox creation remains intact through `ContactInfoPanel`.

Alternative considered: disable the button. Hidden is clearer because the product decision is that standalone creation should not be available from the cases page.

### Decision 4: Make SLA policy select a controlled field

`CaseCreateModal` should own `selectedSlaPolicyId`, reset it with the rest of the form, bind it to the SLA select, and include it in both `/cases/from-conversation/:conversationId` and `/cases` payloads when non-empty.

Alternative considered: derive policy only from priority. The UI already exposes explicit SLA policies, so selection should be real when the user chooses one.

## Risks / Trade-offs

- [Risk] Delete action inside a clickable table row may navigate instead of deleting. → Mitigation: stop propagation on delete button and confirmation dialog.
- [Risk] Delete succeeds but stale SWR data keeps the row visible. → Mitigation: call the list `mutate()` and stats `mutate()` after success.
- [Risk] Backend payload field name may differ from frontend assumption. → Mitigation: use the existing field name expected by case creation code, and verify against API build/tests during apply.
- [Risk] Hiding standalone creation may remove a path some users relied on. → Mitigation: preserve inbox-based case creation, which links cases to conversation context.

## Migration Plan

1. Update `/dashboard/cases` to remove the create button/modal state.
2. Add a delete handler and pass it to `CaseList`.
3. Add a delete action cell in `CaseList` with click isolation and loading/confirmation behavior as needed.
4. Update `CaseCreateModal` to control and submit selected SLA policy id.
5. Add focused checks or tests for the cases page and modal behavior.

Rollback strategy: restore the create button/modal and remove the delete action; the backend and database are unchanged.

## Open Questions

- Should case delete require a custom confirmation message with the case title, or is the browser confirm dialog acceptable for the first implementation?

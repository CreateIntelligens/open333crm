# Tasks: CRM Core Logic

## 1. Contact Management Enhancements
- [x] 1.1 Implement `ContactService.findOrCreateByIdentity` with phone/email resolution
- [x] 1.2 Implement `ContactService.mergeContacts(sourceId, targetId)`
- [x] 1.3 Add standard attributes methods (birthdays, addresses)
- [x] 1.4 Implement identity linking flow (code-based association)

## 2. Case Management Enhancements
- [x] 2.1 Update `schema.prisma` for Case `mergedIntoId`, `parentCaseId`, and `CaseRelation`
- [x] 2.2 Implement strict Case state transition logic
- [x] 2.3 Implement Case merging logic
- [x] 2.4 Implement load-balanced Case assignment (load-based)
- [x] 2.5 Enhance SLA worker to support multiple targets (first response/resolution)

## 3. Automation Engine Implementation
- [x] 3.1 Integrated `json-rules-engine` with Rule model
- [x] 3.2 Implement standard Trigger handlers (message, contact, case)
- [x] 3.3 Implement standard Action runners (send_message, add_tag, create_case)
- [x] 3.4 Add `AutomationExecutionLog` logging

## 4. API Integration
- [x] 4.1 Expose `POST /api/v1/contacts/merge`
- [x] 4.2 Expose `POST /api/v1/cases/:id/merge`
- [x] 4.3 Expose `GET /api/v1/automations/rules` and CRUD

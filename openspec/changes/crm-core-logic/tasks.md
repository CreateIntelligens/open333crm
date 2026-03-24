# Tasks: CRM Core Logic

## 1. Contact Management Enhancements
- [ ] 1.1 Implement `ContactService.findOrCreateByIdentity` with phone/email resolution
- [ ] 1.2 Implement `ContactService.mergeContacts(sourceId, targetId)`
- [ ] 1.3 Add standard attributes methods (birthdays, addresses)
- [ ] 1.4 Implement identity linking flow (code-based association)

## 2. Case Management Enhancements
- [ ] 2.1 Update `schema.prisma` for Case `mergedIntoId`, `parentCaseId`, and `CaseRelation`
- [ ] 2.2 Implement strict Case state transition logic
- [ ] 2.3 Implement Case merging logic
- [ ] 2.4 Implement load-balanced Case assignment (load-based)
- [ ] 2.5 Enhance SLA worker to support multiple targets (first response/resolution)

## 3. Automation Engine Implementation
- [ ] 3.1 Integrated `json-rules-engine` with Rule model
- [ ] 3.2 Implement standard Trigger handlers (message, contact, case)
- [ ] 3.3 Implement standard Action runners (send_message, add_tag, create_case)
- [ ] 3.4 Add `AutomationExecutionLog` logging

## 4. API Integration
- [ ] 4.1 Expose `POST /api/v1/contacts/merge`
- [ ] 4.2 Expose `POST /api/v1/cases/:id/merge`
- [ ] 4.3 Expose `GET /api/v1/automations/rules` and CRUD

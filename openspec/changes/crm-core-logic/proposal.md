# Proposal: CRM Core Logic (Case, Contact, Automation)

## Goal
Implement the core CRM business logic for Open333CRM to provide a unified customer view and automated support workflows. This includes a robust Case lifecycle, identity resolution for multi-channel contacts, and a reactive Automation Engine.

## Context
We have the platform infrastructure (Redis, Event Bus, Database) in place. Now we need to implement the actual CRM features defined in `04_CASE_MANAGEMENT.md`, `05_CONTACT_AND_TAG.md`, and `06_AUTOMATION_AND_EVENT.md`.

## Proposed Changes
1. **Case Management (Doc 04)**:
    - Implement the Case state machine (Open -> Resolved -> Closed).
    - Implement default SLA policies and monitoring workers.
    - Support case merging and assignment (Round Robin).
2. **Contact Management (Doc 05)**:
    - Implement identity resolution (phone/email matching).
    - Support manual contact merging and relationship graphs.
    - Enhance tagging (Case/Conversation/Contact scopes).
3. **Automation Engine (Doc 06)**:
    - Integrate `json-rules-engine` for rule evaluation.
    - Implement core "Actions" (send_message, add_tag, create_case, notify_agent).
    - Support "Triggers" from the Event Bus.

## Expected Impact
- Customer service agents can track issues across multiple channels.
- Common tasks (like tagging VIPs or creating cases from keywords) will be automated.
- Data siloed in different channels will be merged into a single Contact profile.

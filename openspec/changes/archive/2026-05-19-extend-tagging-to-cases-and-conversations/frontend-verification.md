## Frontend Manual Verification Notes

Use these focused checks for the reusable tag picker after the implementation is running:

- Contact detail: open a contact with existing tags, confirm only `CONTACT` scoped tags appear in the picker, add one tag, remove it, and confirm the detail panel refreshes without a full page reload.
- Case detail: open `/dashboard/cases/:caseId`, confirm the case tag section lists only `CASE` scoped tags, add one tag, remove it, and confirm the case detail refreshes.
- Inbox conversation panel: open `/dashboard/inbox?conv=:conversationId`, confirm the conversation tag section lists only `CONVERSATION` scoped tags, add one tag, remove it, and confirm the right panel refreshes.
- Settings tag management: delete a tag and confirm the warning states that contact, conversation, and case assignments are all removed.

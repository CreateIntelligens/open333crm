## 1. Database And Types

- [ ] 1.1 Add `channelType` and `messageSequence` fields to the `Campaign` model with backward-compatible defaults.
- [ ] 1.2 Create and apply a Prisma migration for the campaign sequence fields.
- [ ] 1.3 Regenerate the Prisma client from `@open333crm/database`.
- [ ] 1.4 Define TypeScript types for canonical campaign sequence items: text, image, rich, and campaign sequence payload.
- [ ] 1.5 Document the canonical `messageSequence` shape near the shared/API types with examples for text, image, and rich steps.

## 2. API Validation And Services

- [ ] 2.1 Add Zod schemas for campaign `channelType` and `messageSequence` validation in the marketing API.
- [ ] 2.2 Restrict campaign sequence authoring to LINE and Facebook channel types.
- [ ] 2.3 Add an API-side sequence normalizer/helper with `addText`, `addImage`, and `addRich` semantics for ordering and validation.
- [ ] 2.4 Extend campaign create/update service methods to persist `channelType` and `messageSequence`.
- [ ] 2.5 Extend campaign list/detail responses to include `channelType` and `messageSequence`.
- [ ] 2.6 Ensure sequence create/update does not create broadcasts, enqueue BullMQ jobs, or call channel `sendMessage`.
- [ ] 2.7 Add example request/response fixtures for create, update, reorder, and invalid channel cases.
- [ ] 2.8 Preserve backward compatibility for campaign clients that omit `channelType` and `messageSequence`.

## 3. Channel Authoring Capabilities

- [ ] 3.1 Add LINE authoring capability metadata for text, image, rich steps, native multi-message support, and max five future messages per request.
- [ ] 3.2 Add Facebook authoring capability metadata for text, image, rich steps, sequential future delivery, and no native multi-message request.
- [ ] 3.3 Expose campaign sequence authoring capabilities through a marketing API endpoint or campaign metadata response.
- [ ] 3.4 Keep the existing `ChannelPlugin.sendMessage` contract unchanged.
- [ ] 3.5 Add fixture examples for LINE and Facebook authoring capability metadata.
- [ ] 3.6 Verify capability metadata does not perform network calls to LINE or Facebook.

## 4. Frontend Marketing CRUD

- [ ] 4.1 Extend `useMarketing` hooks with campaign `channelType`, `messageSequence`, and authoring capability data.
- [ ] 4.2 Update `/dashboard/marketing` campaign creation dialog to select LINE or Facebook for sequence authoring.
- [ ] 4.3 Update the campaign detail page with a sequence editor section.
- [ ] 4.4 Implement add text step, add image step, and add rich step controls.
- [ ] 4.5 Implement reorder, enable/disable, delete, and save behavior for sequence steps.
- [ ] 4.6 Show a draft preview that preserves template-variable holes.
- [ ] 4.7 Do not add sequence send controls or call existing broadcast send endpoints from the new editor.
- [ ] 4.8 Make the LINE rich control label user-friendly as Flex while persisting canonical type `rich`.
- [ ] 4.9 Add empty, loading, validation-error, and saved states for the sequence editor.
- [ ] 4.10 Add inline examples or placeholders for common holes such as `{{contact.name}}`, `{{product.url}}`, and `{{campaign.heroImageUrl}}`.

## 5. Verification

- [ ] 5.1 Add focused API tests for campaign create/update/detail with empty, LINE, and Facebook sequences.
- [ ] 5.2 Add validation tests for unsupported channel types and unsupported sequence item types.
- [ ] 5.3 Add frontend coverage or a focused manual verification path for `/dashboard/marketing` campaign sequence CRUD.
- [ ] 5.4 Verify saving a sequence does not create `Broadcast` rows or enqueue BullMQ jobs.
- [ ] 5.5 Verify existing broadcast create/send paths still compile and are not modified for delivery.
- [ ] 5.6 Run `pnpm --filter @open333crm/database db:generate`.
- [ ] 5.7 Run `pnpm --filter @open333crm/api build`.
- [ ] 5.8 Run `pnpm --filter @open333crm/channel-plugins build`.
- [ ] 5.9 Run `pnpm --filter @open333crm/web build`.

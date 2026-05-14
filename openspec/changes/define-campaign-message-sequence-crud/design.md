## Context

`apps/api/src/modules/marketing` already provides campaign CRUD, broadcast CRUD, message templates, and template rendering. The current `Campaign` model stores campaign metadata and links to `Broadcast`, but it has no canonical message sequence for "this campaign advertisement". `/dashboard/marketing` has a campaign list/detail route and template/broadcast UI, but campaign detail is currently focused on metrics and broadcast records.

The desired authoring model is an ordered campaign message sequence:

```ts
campaignSequenceFactory
  .forChannel('LINE')
  .addText({
    text: 'Hi {{contact.name}}, this week offer is ready.',
  })
  .addImage({
    url: '{{campaign.heroImageUrl}}',
    storageKey: 'templates/summer-sale/banner.png',
    altText: 'Summer sale banner',
  })
  .addRich({
    layout: 'carousel',
    cards: [
      {
        title: '{{product.name}}',
        body: '{{product.summary}}',
        imageUrl: '{{product.imageUrl}}',
        actions: [
          { type: 'url', label: 'View', url: '{{product.url}}' },
          { type: 'postback', label: 'Interested', payload: 'interest:{{product.id}}' },
        ],
      },
    ],
  })
  .save();
```

Each `add*` call adds one outbound message step to the campaign sequence. The call does not construct a message body from scratch; text/image/rich message bodies keep using existing template-variable holes and are stored as canonical payloads for later rendering. This change only covers CRUD and authoring for LINE/FB campaign sequences. It does not deliver messages.

The stored value is a canonical JSON array on `Campaign.messageSequence`, not LINE Flex JSON or Facebook Generic Template JSON:

```json
[
  {
    "id": "step_text_intro",
    "order": 1,
    "type": "text",
    "enabled": true,
    "content": {
      "text": "Hi {{contact.name}}, this week offer is ready."
    }
  },
  {
    "id": "step_image_banner",
    "order": 2,
    "type": "image",
    "enabled": true,
    "content": {
      "url": "{{campaign.heroImageUrl}}",
      "storageKey": "templates/summer-sale/banner.png",
      "altText": "Summer sale banner"
    }
  },
  {
    "id": "step_rich_products",
    "order": 3,
    "type": "rich",
    "enabled": true,
    "content": {
      "schema": "o333.rich.v1",
      "layout": "carousel",
      "fallbackText": "{{product.name}} - {{product.url}}",
      "cards": [
        {
          "title": "{{product.name}}",
          "body": "{{product.summary}}",
          "imageUrl": "{{product.imageUrl}}",
          "actions": [
            { "type": "url", "label": "View", "url": "{{product.url}}" },
            { "type": "postback", "label": "Interested", "payload": "interest:{{product.id}}" }
          ]
        }
      ]
    }
  }
]
```

## Goals / Non-Goals

**Goals:**
- Add API CRUD support for campaign channel selection and ordered campaign message sequences.
- Support LINE and Facebook authoring only.
- Support text, image, and rich-card/flex-like sequence steps.
- Persist sequence data in the database as canonical payloads that can later be rendered and sent by a separate change.
- Add frontend authoring in the existing `/dashboard/marketing` route and campaign detail page.
- Expose channel capability metadata so the frontend can restrict step types and limits by LINE/FB.

**Non-Goals:**
- Do not send campaign sequences.
- Do not modify BullMQ workers, broadcast polling, scheduling, recipient targeting, or delivery metrics.
- Do not implement WhatsApp, Telegram, Threads, or Webchat sequence authoring.
- Do not replace existing message template CRUD or broadcast CRUD.
- Do not implement native LINE/FB payload conversion for delivery beyond authoring capability metadata.

## Decisions

1. Store the campaign sequence on `Campaign` as canonical JSON.
   - Add `channelType String?` and `messageSequence Json @default("[]")` to `Campaign`.
   - Rationale: the sequence is draft campaign content, not delivery history. JSON matches the existing `MessageTemplate.body Json` pattern and avoids unnecessary sequence tables before sending/analytics requirements exist.
   - Alternative considered: a normalized `CampaignMessageStep` table. That would help per-step metrics later, but this change explicitly excludes sending and delivery metrics.

2. Use a canonical sequence item contract.
   - Each item has `id`, `order`, `type`, `enabled`, and `content`.
   - Supported types: `text`, `image`, `rich`.
   - `text` content stores `text` with template holes.
   - `image` content stores URL/storage references plus optional text/alt text.
   - `rich` content stores a channel-neutral card/carousel payload that LINE can later map to Flex and FB can later map to Generic Template/Carousel.
   - Rationale: the API/UI can author once while future delivery logic can render by channel.

   Example create request:

   ```http
   POST /api/v1/marketing/campaigns
   Content-Type: application/json

   {
     "name": "Summer sale",
     "description": "LINE draft for VIP contacts",
     "channelType": "LINE",
     "messageSequence": [
       {
         "id": "step_1",
         "order": 1,
         "type": "text",
         "enabled": true,
         "content": { "text": "{{contact.name}} hello" }
       },
       {
         "id": "step_2",
         "order": 2,
         "type": "image",
         "enabled": true,
         "content": { "url": "{{campaign.heroImageUrl}}", "altText": "Hero image" }
       }
     ]
   }
   ```

   Example update request for reordering:

   ```http
   PATCH /api/v1/marketing/campaigns/{campaignId}
   Content-Type: application/json

   {
     "messageSequence": [
       { "id": "step_2", "order": 1, "type": "image", "enabled": true, "content": { "url": "{{campaign.heroImageUrl}}" } },
       { "id": "step_1", "order": 2, "type": "text", "enabled": true, "content": { "text": "{{contact.name}} hello" } }
     ]
   }
   ```

3. Add an API-side sequence builder/normalizer, not a transport sender.
   - The backend should expose helper semantics equivalent to `addText()`, `addImage()`, and `addRich()` for validation and ordering, but route handlers should persist normalized sequence JSON.
   - Rationale: this captures the factory/builder intent without coupling CRUD to channel send behavior.

4. Expose LINE/FB authoring capabilities from channel-plugin boundaries.
   - Add metadata such as supported step types, max sequence length, rich card layouts, and platform notes.
   - LINE authoring can allow native multi-message semantics up to five messages per request for future send behavior.
   - FB authoring should treat multi-step campaigns as a sequence that future sending will dispatch as separate requests.
   - Rationale: UI rules should come from channel capabilities, not hard-coded marketing page conditionals.

   Example capability metadata:

   ```json
   {
     "LINE": {
       "supportedStepTypes": ["text", "image", "rich"],
       "nativeMultiMessage": true,
       "maxMessagesPerFutureRequest": 5,
       "richLayouts": ["single", "carousel"],
       "notes": ["Future delivery can batch enabled steps into LINE messages array."]
     },
     "FB": {
       "supportedStepTypes": ["text", "image", "rich"],
       "nativeMultiMessage": false,
       "maxMessagesPerFutureRequest": 1,
       "richLayouts": ["single", "carousel"],
       "notes": ["Future delivery must send sequence steps one request at a time."]
     }
   }
   ```

5. Keep existing campaign and broadcast APIs compatible.
   - Existing campaign create/update/list/detail endpoints continue to work when `channelType` and `messageSequence` are omitted.
   - Broadcast send endpoints and worker code remain untouched.
   - Rationale: this is an authoring feature, not a delivery migration.

## Risks / Trade-offs

- JSON sequence drift -> Define Zod schemas in the API and reuse equivalent frontend types.
- Channel-specific constraints leak into UI -> Read capability metadata for LINE/FB step availability and limits.
- Users confuse "active campaign" with "sent campaign" -> UI copy must make sequence editing clearly draft/authoring-only; no send buttons are added for the new sequence.
- Future per-step metrics need normalization -> JSON is acceptable now; a later send/analytics change can introduce generated delivery records or normalized snapshots.
- Existing broadcast metrics dominate campaign detail -> Keep broadcast records visible but add a distinct message sequence editor section.

## Migration Plan

1. Add Prisma fields to `Campaign` and generate the database client.
2. Add API validation schemas for `channelType` and `messageSequence`.
3. Extend campaign create/update/get/list services to persist and return sequence data.
4. Add capability endpoint or include LINE/FB authoring capabilities in marketing API responses.
5. Update marketing hooks and `/dashboard/marketing` UI to create campaigns with LINE/FB channel selection.
6. Update campaign detail page with sequence editor CRUD: add text, add image, add rich, reorder, delete, enable/disable, save.
7. Verify API and web builds plus focused marketing route behavior.

Rollback: remove the frontend sequence editor and stop sending `channelType`/`messageSequence`; existing campaigns remain readable because the added DB fields are optional/defaulted. If database rollback is required, drop the added columns after confirming no active campaigns depend on them.

## Agent Handoff Notes

- Do not implement send behavior in this change. Search for `sendMessage`, `executeBroadcast`, `broadcast:poll`, or BullMQ queue changes during review; those should not be part of this scope.
- Keep the canonical stored `type` as `rich`, even if the UI label says "Flex" for LINE. LINE Flex and Facebook Generic Template are future renderer outputs, not the persisted campaign sequence source of truth.
- Store template holes exactly as entered, such as `{{contact.name}}`, `{{product.url}}`, and `{{campaign.heroImageUrl}}`. Do not require contact data in CRUD or preview.
- Existing `Broadcast.templateId` remains separate. The new `Campaign.messageSequence` is a draft campaign composition, not a broadcast record.
- If a future implementer wants per-step metrics, create delivery snapshots later rather than over-normalizing this CRUD-only change now.

## Open Questions

- Should campaign `channelType` be required for all newly-created campaigns or only required once a sequence is added?
- Should image steps store uploaded `storageKey` only, public URL only, or both?
- Should `rich` keep the UI label "Flex" for LINE users while storing a neutral `rich` type internally?

## 1. Frontend — Restrict Attachment Picker

- [x] 1.1 In `apps/web/src/components/inbox/MessageInput.tsx`, change `ACCEPTED_TYPES` constant from `'image/jpeg,image/png,image/gif,image/webp,application/pdf'` to `'image/png'`
- [x] 1.2 In the same file, update `handleFileSelect` to guard: if `file.type !== 'image/png'`, show `alert('只支援 PNG 圖片')` and return early (server-side also validates, this is a UX guard)

## 2. API — `POST /api/v1/conversations/:conversationId/send-image`

- [x] 2.1 In `apps/api/src/modules/conversation/conversation.routes.ts`, add route `POST /:id/send-image` (multipart). Use `request.file()` to receive the upload. Validate: file present, `mimetype === 'image/png'`, `buffer.length <= 20 * 1024 * 1024`; throw `AppError` with 400 on failure
- [x] 2.2 Resolve the conversation (with `channel`) using `prisma.conversation.findUnique`. If not found or `tenantId` mismatch, throw 404. If `channel.channelType !== 'LINE'`, return `reply.status(501).send({ code: 'NOT_IMPLEMENTED', message: 'Image push not yet supported for this channel type' })` — add a `// TODO: implement for WEBCHAT, FACEBOOK` comment
- [x] 2.3 Upload file to MinIO via `uploadFile(buffer, file.filename, file.mimetype, tenantId, 'media', conversationId)` from `storage.service.ts`
- [x] 2.4 Call `sendMessage(prisma, io, conversationId, tenantId, { contentType: 'image', content: { url: result.url, mediaUrl: result.url, text: '[圖片]', storageKey: result.key } })` — reuse the existing service function
- [x] 2.5 Return HTTP 201 with the message object from `sendMessage`

## 3. Verification

- [x] 3.1 Run `pnpm --filter @open333crm/api exec tsc --noEmit` to confirm no type errors
- [ ] 3.2 Manually verify: upload a PNG from the inbox → LINE receives image → message appears in chat window with `content.url` rendering via `MessageBubble`

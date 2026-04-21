## 1. Upgrade `packages/core` logger

- [x] 1.1 Install `winston-daily-rotate-file` in `packages/core`: add to `dependencies` in `packages/core/package.json` and run `pnpm install`
- [x] 1.2 Rewrite `packages/core/src/logger/index.ts` to read `LOG_TRANSPORT` (`console`|`file`|`both`, default `console`), `LOG_DIR` (default `./logs`), `LOG_MAX_FILES` (default `14d`). Add Console transport when `LOG_TRANSPORT` is `console` or `both`. Add `DailyRotateFile` transport (JSON format, `zippedArchive: true`) when `LOG_TRANSPORT` is `file` or `both`
- [x] 1.3 Build `packages/core` to emit updated dist: `pnpm --filter @open333crm/core build`

## 2. Migrate `apps/api` — worker/scheduler files

- [x] 2.1 `apps/api/src/modules/automation/automation.worker.ts` — add `import { logger } from '@open333crm/core'`, replace all `console.*`
- [x] 2.2 `apps/api/src/modules/notification/notification.worker.ts` — replace all `console.*`
- [x] 2.3 `apps/api/src/modules/sla/sla.worker.ts` — replace all `console.*`
- [x] 2.4 `apps/api/src/modules/canvas/canvas.worker.ts` — replace all `console.*`
- [x] 2.5 `apps/api/src/modules/canvas/canvas.scheduler.ts` — replace all `console.*`
- [x] 2.6 `apps/api/src/modules/csat/csat.scheduler.ts` — replace all `console.*`
- [x] 2.7 `apps/api/src/modules/analytics/analytics.scheduler.ts` — replace all `console.*`
- [x] 2.8 `apps/api/src/modules/marketing/broadcast.scheduler.ts` — replace all `console.*`

## 3. Migrate `apps/api` — service files

- [x] 3.1 `apps/api/src/modules/webhook/webhook.service.ts` — replace all `console.*`
- [x] 3.2 `apps/api/src/modules/conversation/conversation.service.ts` — already imports `logger`, replace any remaining `console.*`
- [x] 3.3 `apps/api/src/modules/ai/ai.service.ts` — add import, replace all `console.*`
- [x] 3.4 `apps/api/src/modules/ai/classify.service.ts` — add import, replace all `console.*`
- [x] 3.5 `apps/api/src/modules/ai/kb-autoreply.service.ts` — add import, replace all `console.*`
- [x] 3.6 `apps/api/src/modules/ai/sentiment.service.ts` — add import, replace all `console.*`
- [x] 3.7 `apps/api/src/modules/csat/csat.service.ts` — add import, replace all `console.*`
- [x] 3.8 `apps/api/src/modules/case/case.service.ts` — add import, replace all `console.*`
- [x] 3.9 `apps/api/src/modules/case/assignment.service.ts` — add import, replace all `console.*`
- [x] 3.10 `apps/api/src/modules/channel/fb-token-monitor.service.ts` — add import, replace all `console.*`
- [x] 3.11 `apps/api/src/modules/channel/line-webhook-setup.service.ts` — add import, replace all `console.*`
- [x] 3.12 `apps/api/src/modules/email/email.service.ts` — add import, replace all `console.*`
- [x] 3.13 `apps/api/src/modules/embedding/embedding.service.ts` — add import, replace all `console.*`
- [x] 3.14 `apps/api/src/modules/knowledge/knowledge.service.ts` — add import, replace all `console.*`
- [x] 3.15 `apps/api/src/modules/marketing/marketing.service.ts` — add import, replace all `console.*`
- [x] 3.16 `apps/api/src/modules/shortlink/shortlink.service.ts` — add import, replace all `console.*`
- [x] 3.17 `apps/api/src/modules/storage/line-media.service.ts` — add import, replace all `console.*`
- [x] 3.18 `apps/api/src/modules/storage/s3.provider.ts` — add import, replace all `console.*`
- [x] 3.19 `apps/api/src/modules/webchat/webchat.socket.ts` — add import, replace all `console.*`
- [x] 3.20 `apps/api/src/modules/webhook-subscriptions/webhook-dispatcher.ts` — add import, replace all `console.*`
- [x] 3.21 `apps/api/src/modules/automation/engine/action-executor.ts` — add import, replace all `console.*`
- [x] 3.22 `apps/api/src/services/channel-team-access.ts` — add import, replace all `console.*`
- [x] 3.23 `apps/api/src/services/inbound-router.ts` — add import, replace all `console.*`
- [x] 3.24 `apps/api/src/services/license.ts` — add import, replace all `console.*`
- [x] 3.25 `apps/api/src/services/message.ts` — add import, replace all `console.*`

## 4. Migrate `apps/workers`, `packages/*`

- [x] 4.1 `apps/workers/src/index.ts` — already imports `logger`, replace any remaining `console.*`
- [x] 4.2 `packages/channel-plugins/src/telegram/index.ts` — add import, replace all `console.*`
- [x] 4.3 `packages/channel-plugins/src/webchat/index.ts` — add import, replace all `console.*`
- [x] 4.4 `packages/brain/src/services/MarkitdownService.ts` — reverted: `packages/brain` has no `@open333crm/core` dep (would pull prisma/bullmq/redis); kept `console.*`
- [x] 4.5 `packages/brain/src/services/SummarizationService.ts` — reverted: same reason as 4.4
- [x] 4.6 `packages/brain/src/services/WhisperService.ts` — reverted: same reason as 4.4
- [x] 4.7 `packages/automation/src/action-registry/index.ts` — reverted: `packages/automation` has no `@open333crm/core` dep; kept `console.*`

## 5. Documentation & verification

- [x] 5.1 Add `LOG_TRANSPORT`, `LOG_DIR`, `LOG_MAX_FILES` to `.env.example` (or equivalent env doc) with comments explaining each option
- [x] 5.2 Run `pnpm --filter @open333crm/api exec tsc --noEmit` and `pnpm --filter @open333crm/workers exec tsc --noEmit` to confirm no type errors
- [x] 5.3 Verify no remaining `console.log/warn/error` in backend files: `grep -rn "console\." apps/api/src apps/workers/src packages/channel-plugins/src packages/brain/src packages/automation/src --include="*.ts" | grep -v "\.d\.ts"`

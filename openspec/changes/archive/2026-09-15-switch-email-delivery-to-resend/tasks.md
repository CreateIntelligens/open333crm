## 1. Dependency and configuration

- [x] 1.1 Add the `resend` dependency to `apps/api/package.json`, update the pnpm lockfile, and verify `pnpm install --lockfile-only` completes successfully
- [x] 1.2 Extend `apps/api/src/config/env.ts` with `resend` delivery mode plus `RESEND_API_KEY` and Resend-mode validation, and verify missing-key/missing-sender cases fail with focused config tests

## 2. Email delivery implementation

- [x] 2.1 Add a lazy Resend client in the shared email service and map `SendEmailInput` to the provider payload, verifying a mocked successful send receives the expected from/to/subject/html/text fields
- [x] 2.2 Record the provider message ID on successful Resend sends without changing the `sendEmail()` input contract, verifying logs contain the ID but no API key or full HTML body
- [x] 2.3 Handle Resend provider, timeout, and network errors without SMTP fallback, verifying the email service rejects and does not construct or call the SMTP transporter
- [x] 2.4 Verify `log`, `webhook`, and `smtp` modes retain their existing dispatch behavior and that the default mode remains `log`

## 3. Regression coverage

- [x] 3.1 Add or update email service tests for mode selection, configuration errors, field mapping, provider errors, sensitive-data redaction, and SMTP non-interference
- [x] 3.2 Verify trial, platform-user, usage-alert, and canvas email paths still call the shared email service and preserve their existing template subjects and content
- [x] 3.3 Run `pnpm --filter @open333crm/api build` and the focused email tests; record any unrelated pre-existing failure separately

> Verification note: `test:email` passes. The API build remains blocked by pre-existing Prisma client drift from the pulled platform-user migration: generated `PlatformUser` types do not yet contain `mustChangePassword`, `resetTokenHash`, or `resetTokenExpiresAt`, causing errors in platform auth/password-recovery files.

## 4. Documentation and rollout

- [x] 4.1 Update `.env.*.example`, `docs/10_TECH_STACK.md`, and `docs/20_NOTIFICATION.md` with Resend setup, verified sender-domain requirements, and the production mode setting; verify no example instructs users to configure Gmail SMTP as the primary path
- [x] 4.2 Document rollback to `EMAIL_DELIVERY_MODE=smtp` and the rule to keep the Resend API key server-side, then verify the deployment instructions contain no real credentials
- [x] 4.3 Update `CHANGELOG.md` under the latest date-only release heading with the Resend email delivery support, then run `openspec validate switch-email-delivery-to-resend --type change --strict`

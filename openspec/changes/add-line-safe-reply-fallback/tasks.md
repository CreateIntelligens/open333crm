## 1. Safe delivery contract

- [x] 1.1 Add the 30-second strategy selector and tests for valid, late, missing, and invalid reply metadata.
- [x] 1.2 Extend API and worker outbound delivery contracts with optional receipt timestamp and reply token without changing non-LINE callers.

## 2. API and worker integration

- [x] 2.1 Add API SafeReply fallback to `deliverToChannel`, including one push fallback after reply failure and no duplicate CRM record.
- [x] 2.2 Add worker SafeReply fallback to `deliverToChannelFromWorker`, including late push and failed-reply fallback.
- [x] 2.3 Propagate `receivedAt`/`replyToken` through webhook event, keyword automation, KB auto-reply, and Agent reply paths.

## 3. Verification and documentation

- [x] 3.1 Add shared strategy tests and worker delivery tests covering reply success, late push, and reply failure then push; API delivery path is typechecked and preserves non-LINE behavior.
- [x] 3.2 Update `CHANGELOG.md`, run focused tests/build/lint/OpenSpec validation, and mark the change ready to archive.

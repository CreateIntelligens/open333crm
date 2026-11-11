## ADDED Requirements

### Requirement: 發起刪除的寫入一起成立

發起刪除時，系統 MUST 在同一個交易寫入請求、`data.erasure.request` 稽核與刪除工作。其中一項寫不進去時，系統 MUST NOT 留下另外兩項，並回錯誤。刪除工作 MUST 在交易 commit 之後才送進 `data-erasure` 佇列，至少送出一次。commit 之後送不進佇列時，系統 MUST 仍回成功，請求維持 `pending`，刪除工作 MUST 留在 outbox，由補送排程送出。

#### Scenario: 刪除工作寫不進 outbox 時不留下請求與稽核

- **WHEN** 成員發起刪除，刪除工作寫不進 outbox
- **THEN** 系統回錯誤，該聯絡人沒有刪除請求，也沒有 `data.erasure.request` 稽核

#### Scenario: 稽核寫不進去時不送出刪除工作

- **WHEN** 成員發起刪除，`data.erasure.request` 稽核寫不進去
- **THEN** 交易 rollback，刪除工作 MUST NOT 送進佇列

#### Scenario: commit 之後送不進佇列時，請求仍然成立

- **WHEN** 成員發起刪除，交易 commit 之後刪除工作送不進佇列
- **THEN** 系統回 HTTP 200，請求是 `pending`，刪除工作留在 outbox，還沒有標記已送出

## MODIFIED Requirements

### Requirement: 稽核寫入失敗不影響主操作

在交易之外寫稽核時，`writeTenantAudit()` 寫入失敗 SHALL 只記錄錯誤 log，SHALL NOT 拋出錯誤，所以呼叫它的主操作照常回應。這個函式只給還沒改成在交易內寫稽核的呼叫端使用；交易內的稽核見「交易內的稽核與主操作一起 commit」。

#### Scenario: 稽核寫入失敗不拋錯
- **WHEN** `writeTenantAudit()` 寫入資料庫時發生錯誤
- **THEN** 函式正常結束，不拋出錯誤

## ADDED Requirements

### Requirement: 交易內的稽核與主操作一起 commit

在綁定租戶的交易內寫稽核時，稽核 SHALL 與主操作的寫入一起 commit 或一起 rollback。稽核的 `tenantId` SHALL 是交易綁定的租戶，呼叫端 SHALL NOT 指定。稽核寫入失敗時，系統 SHALL 拋出錯誤，交易 rollback，主操作的寫入 SHALL NOT 留在資料庫。

#### Scenario: 稽核與主操作一起寫入
- **WHEN** 綁定租戶 A 的交易內建立一個角色，接著寫一筆稽核，之後交易 commit
- **THEN** 資料庫中有該角色，也有該筆稽核，稽核的 `tenantId` 是 A

#### Scenario: 稽核寫入失敗時主操作 rollback
- **WHEN** 綁定租戶的交易內建立一個角色，接著寫一筆稽核，稽核的 `actorId` 是不存在的成員，所以寫入違反外鍵
- **THEN** 呼叫端收到錯誤，資料庫中 MUST NOT 有該角色，也 MUST NOT 有該筆稽核

## ADDED Requirements

### Requirement: 成員以 JWT 呼叫合作方推送時依角色權限判斷

`POST /api/v1/knowledge/partner-ingest` SHALL 接受 Partner API 金鑰，也接受成員的 access token。成員以 access token 呼叫時，系統 MUST 以該成員角色的有效權限判斷 `knowledge.admin`。

#### Scenario: 有知識庫進階權限的成員推送文件

- **WHEN** 角色有 `knowledge.admin` 的成員以 access token 呼叫 `POST /api/v1/knowledge/partner-ingest`，`cmd` 是 `CREATE`，`DocID` 在本租戶不存在
- **THEN** 系統回 200，`data.status` 是 `created`，本租戶多一篇 `externalDocId` 等於該 `DocID` 的文章

#### Scenario: 沒有知識庫進階權限的成員推送文件

- **WHEN** 角色只有 `knowledge.view` 與 `knowledge.manage` 的成員以 access token 呼叫 `POST /api/v1/knowledge/partner-ingest`
- **THEN** 系統回 403 `FORBIDDEN`，`error.details.requiredPermission` 是 `knowledge.admin`，不寫入文章

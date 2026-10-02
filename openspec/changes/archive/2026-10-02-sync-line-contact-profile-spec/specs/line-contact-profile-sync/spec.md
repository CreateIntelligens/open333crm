## ADDED Requirements

### Requirement: 客服可以重抓 LINE 聯絡人的個人資料
系統 SHALL 提供需要登入的端點 `PATCH /api/v1/channels/:channelId/contacts/:lineUid/sync-profile`。端點以該渠道的憑證呼叫 LINE Messaging API 的 `GET /v2/bot/profile/{lineUid}`。端點把 LINE 回傳的 `displayName` 與 `pictureUrl`，寫入符合 `channelId` 與 `lineUid` 的那一筆 `ChannelIdentity`。端點 SHALL NOT 修改 `Contact` 的名稱與頭像，以保留客服對聯絡人的修改。

#### Scenario: 同步成功
- **WHEN** 持有 `contact.update` 的客服，以自己租戶的 LINE 渠道與該渠道上存在的 `lineUid` 呼叫端點
- **THEN** 系統以該 `lineUid` 呼叫 LINE 的 profile API
- **THEN** `ChannelIdentity.profileName` 改為回傳的 `displayName`，`ChannelIdentity.profilePic` 改為回傳的 `pictureUrl`
- **THEN** 回傳 HTTP 200，`data` 為 `uid`、`profileName`、`profilePic`

#### Scenario: 不改聯絡人本身
- **WHEN** 同步成功
- **THEN** `Contact.displayName` 與 `Contact.avatarUrl` 不變

#### Scenario: 只改目標那一筆身分
- **WHEN** 同一個渠道有多位聯絡人，客服同步其中一位
- **THEN** 只有該 `lineUid` 的 `ChannelIdentity` 被修改，同渠道的其他身分不變

#### Scenario: 找不到身分
- **WHEN** 渠道存在，但沒有符合 `lineUid` 的 `ChannelIdentity`
- **THEN** 回傳 HTTP 404，不呼叫 LINE

#### Scenario: 未登入
- **WHEN** 請求沒有有效的客服 access token
- **THEN** 回傳 HTTP 401，不呼叫 LINE

#### Scenario: LINE 回錯誤
- **WHEN** LINE 的 profile API 回傳錯誤，例如 uid 無效或渠道權杖被撤銷
- **THEN** 回傳 HTTP 502，錯誤碼為 `UPSTREAM_ERROR`

#### Scenario: channelId 格式錯誤
- **WHEN** `channelId` 不是 UUID
- **THEN** 回傳 HTTP 400，不呼叫 LINE

### Requirement: 只能同步自己租戶、看得到、啟用中的 LINE 渠道
端點 SHALL 只接受同時符合下列條件的渠道：

- 屬於客服的租戶。
- 在客服的渠道可見範圍內。
- 啟用中。
- 類型是 LINE。

只要有一項條件不符合，端點 SHALL 回傳 HTTP 404，不呼叫 LINE，也不寫入任何 `ChannelIdentity`。每一種情況回傳相同的 404，因此客服無法從回應分辨渠道是否存在於其他租戶。

#### Scenario: 其他租戶的渠道
- **WHEN** 客服以其他租戶 LINE 渠道的 `channelId` 與該渠道上存在的 `lineUid` 呼叫端點
- **THEN** 回傳 HTTP 404
- **THEN** 不呼叫 LINE，該 `ChannelIdentity` 不變

#### Scenario: 渠道不在成員的可見範圍
- **WHEN** 渠道屬於客服的租戶，但只授權給其他成員或團隊，而且客服沒有 `channel.view_all`
- **THEN** 回傳 HTTP 404，不呼叫 LINE，該 `ChannelIdentity` 不變

#### Scenario: 渠道已停用
- **WHEN** 渠道屬於客服的租戶，但 `isActive` 為 `false`
- **THEN** 回傳 HTTP 404，不呼叫 LINE

#### Scenario: 非 LINE 渠道
- **WHEN** 渠道屬於客服的租戶，但類型不是 LINE，例如 WebChat
- **THEN** 回傳 HTTP 404，不呼叫 LINE

### Requirement: 重抓個人資料需要 contact.update 權限
端點 SHALL 要求客服的有效權限包含 `contact.update`。

#### Scenario: 沒有 contact.update
- **WHEN** 客服的角色只有 `contact.view`
- **THEN** 回傳 HTTP 403，不呼叫 LINE

## ADDED Requirements

### Requirement: 一般群發記錄每位收件人的失敗原因
一般群發的收件人送不出時，收件紀錄 SHALL 為 `deliveryStatus = failed`、`skipReason = DELIVERY_FAILED`；送達的收件紀錄 `skipReason` SHALL 為 null。LINE multicast 一批失敗時，該批每位收件人 SHALL 都寫這個原因。重新發送時，既有收件紀錄的狀態與原因 SHALL 依這次的結果更新。`GET /marketing/broadcasts/:id/recipients?status=failed` SHALL 列出一般群發失敗的收件人與原因。

#### Scenario: 逐人送出時一位收件人失敗
- **GIVEN** 一般群發要送甲、乙，渠道拒收給乙的訊息
- **WHEN** 群發發送
- **THEN** 甲的收件紀錄為 `sent`、原因 null；乙為 `failed`、原因 `DELIVERY_FAILED`
- **AND** 廣播為 `completed`，`GET /recipients?status=failed` 只列出乙與原因 `DELIVERY_FAILED`

#### Scenario: multicast 整批失敗
- **WHEN** LINE 無變數的一般群發以 multicast 送出，渠道拒絕這一批
- **THEN** 這一批每位收件人的收件紀錄都是 `failed`、原因 `DELIVERY_FAILED`

#### Scenario: 重新發送後成功
- **GIVEN** 乙上次的收件紀錄是 `failed`、原因 `DELIVERY_FAILED`
- **WHEN** 群發重新發送，這次送達乙
- **THEN** 乙的收件紀錄改為 `sent`、原因 null

### Requirement: 所有廣播都可以查看收件人結果
廣播列表 SHALL 對每一則 `completed`、`failed` 或 `sending` 的廣播顯示結果按鈕，附券與一般群發都有。一般群發的結果 SHALL 顯示成功、失敗與略過人數，並列出失敗的收件人與中文原因。

#### Scenario: 一般群發的結果按鈕
- **WHEN** 廣播列表有一則已完成的一般群發
- **THEN** 那一列有「發送結果」按鈕

#### Scenario: 一般群發的結果列出失敗的人
- **WHEN** 管理者打開一則一般群發的結果，`GET /recipients?status=failed` 回傳乙、原因 `DELIVERY_FAILED`
- **THEN** 結果顯示成功與失敗人數，並列出乙與「訊息送不出（顧客可能已封鎖）」

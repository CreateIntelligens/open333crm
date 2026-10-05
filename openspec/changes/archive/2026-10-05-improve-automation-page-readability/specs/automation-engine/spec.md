## ADDED Requirements

### Requirement: Rule Summary Sentence
The rule list and the rule editor SHALL describe each rule in one Traditional Chinese sentence built from the contract labels: 「當<event>時，如果<conditions>，就<actions>」. Conditions in an `all` group SHALL be joined by「，而且」and in an `any` group by「，或」, with nested groups in parentheses. A rule with no conditions SHALL read「當<event>時，就<actions>」. For a `keyword.matched` rule with keywords, the event part SHALL name the keywords:「訊息含有「A」或「B」」for match mode `any` and「訊息同時含有「A」和「B」」for `all`. A condition node that the summary cannot describe, such as `not`, SHALL be shown as「（無法顯示的條件）」and SHALL NOT be dropped. Each action SHALL show its label and, when it has one, its main text parameter in「」. A parameter that holds an ID, such as `materialId` or `agentId`, SHALL NOT be shown.

#### Scenario: Rule with one condition and one action
- **WHEN** a `message.received` rule has the condition `case.open.count` equal to 0 and the action `create_case` with title「客戶諮詢」
- **THEN** the summary is「當收到訊息時，如果開啟案件數等於 0，就建立工單「客戶諮詢」」

#### Scenario: Rule with any-group conditions
- **WHEN** a rule's conditions are an `any` group of `message.text` contains「退款」and `message.text` contains「客訴」
- **THEN** the conditions read「訊息內容包含「退款」，或訊息內容包含「客訴」」

#### Scenario: Keyword rule names its keywords
- **WHEN** a `keyword.matched` rule has keywords「營業時間」and「幾點開」with match mode `any`, no conditions, and the action `send_message`
- **THEN** the summary starts with「當訊息含有「營業時間」或「幾點開」時」

#### Scenario: Unknown condition node
- **WHEN** a rule's conditions are `{ all: [{ not: { … } }] }`
- **THEN** the conditions read「（無法顯示的條件）」

#### Scenario: Select value shown by label
- **WHEN** a condition compares `case.priority` equal to `HIGH`
- **THEN** the condition reads「案件優先級等於高」

### Requirement: Rule List Is Readable
The rule list SHALL show the event by its contract label, the summary sentence and the active state, and SHALL keep every column visible when a rule name is long. The list SHALL NOT show the execution count while the workers do not update it (AUDIT AUTO-02). The list SHALL let the administrator search rules by name and filter them by active state.

#### Scenario: Event shown by label
- **WHEN** a rule's event is `conversation.created`
- **THEN** the list shows「新對話建立」and not `conversation.created`

#### Scenario: Search by name
- **WHEN** the administrator types「開案」in the search box
- **THEN** the list shows only rules whose name contains「開案」

#### Scenario: Filter by active state
- **WHEN** the administrator selects「已停用」
- **THEN** the list shows only rules with `isActive` false

### Requirement: Rule Editor Uses Plain Language
The rule editor SHALL label `priority` as「執行順序」and explain that a larger number is checked first, SHALL label `stopOnMatch` as「這條規則執行後，不再檢查其他規則」with an explanation, SHALL show the condition builder in Traditional Chinese, and SHALL show the description of the selected event. Events whose `dispatched` is false in the contract SHALL be marked「（目前不會觸發）」in the event menu, and selecting one SHALL show that rules with this event never run.

#### Scenario: Condition builder in Chinese
- **WHEN** the administrator opens the condition section
- **THEN** the controls read「全部符合」「任一符合」「新增條件」「新增條件群組」and no English control text is shown

#### Scenario: Event that never triggers
- **WHEN** the administrator selects「工單關閉」
- **THEN** the menu shows「工單關閉（目前不會觸發）」and the editor warns that rules with this event never run

### Requirement: Rule Test Uses A Form
The rule editor SHALL let the administrator test a saved rule by filling one input for each fact that the rule's conditions use, labeled with the fact's contract label and typed by the fact's type. Each value SHALL be sent in the fact's contract type: a boolean fact as a boolean, a `string_array` fact as an array, and a datetime fact as an ISO 8601 string with a time zone. The result SHALL say in Traditional Chinese whether the rule triggers and, when it does, which actions run. When the conditions match but the rule is inactive, or its event is not dispatched, the result SHALL say that the rule does not run. For a `keyword.matched` rule, the result SHALL say that the message must also contain a keyword. The editor SHALL say that the test runs the saved version of the rule, and SHALL clear the result when the saved rule reloads. When the saved rule has no conditions, the editor SHALL explain, based on the saved rule, whether it runs every time, runs only on a keyword hit, or does not run because it is inactive or its event is not dispatched.

#### Scenario: Inputs follow the conditions
- **WHEN** a rule's conditions use `message.text` and `case.open.count`
- **THEN** the test form shows「訊息內容」as a text input and「開啟案件數」as a number input

#### Scenario: Rule triggers
- **WHEN** the administrator enters 0 for「開啟案件數」and the rule's condition is `case.open.count` equal to 0
- **THEN** the result reads「會觸發」and lists「建立工單「客戶諮詢」」

#### Scenario: Rule does not trigger
- **WHEN** the entered values do not satisfy the conditions
- **THEN** the result reads「不會觸發：條件不符合」

#### Scenario: Conditions match but the rule is inactive
- **WHEN** the entered values satisfy the conditions of an inactive rule
- **THEN** the result reads「條件符合，但規則目前停用，不會執行」

#### Scenario: Inactive rule without conditions
- **WHEN** the administrator opens an inactive rule that has no conditions
- **THEN** the test section reads「這條規則沒有條件，但目前停用，不會執行。」

#### Scenario: Boolean fact
- **WHEN** a rule's condition is `contact.isVip` equal true and the administrator selects「是」
- **THEN** the test sends `contact.isVip` as the boolean true

#### Scenario: Action with an ID parameter
- **WHEN** a rule's action is `send_material` with a `materialId`
- **THEN** the summary shows「傳送素材」without the ID

### Requirement: New Rule Keeps The Chosen Active State
Creating a rule SHALL store the active state that the request sends in `isActive`. When the request does not send `isActive`, the rule SHALL be created active, so that existing API clients keep their behavior.

#### Scenario: Create an inactive rule
- **WHEN** the administrator creates a rule with「啟用這條規則」unchecked
- **THEN** the API stores the rule with `isActive` false, and the rule does not run

#### Scenario: Client that does not send the active state
- **WHEN** an API client creates a rule without `isActive`
- **THEN** the rule is created active

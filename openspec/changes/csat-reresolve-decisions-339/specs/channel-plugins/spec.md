## ADDED Requirements

### Requirement: Channel plugins declare whether they can send a CSAT survey
`ChannelPlugin` SHALL have an optional method `buildCsatSurvey(input)` that returns a CSAT survey payload with tappable score options. Only plugins whose customers can answer the survey SHALL implement it; today only LINE does, with a Flex message. The CSAT module SHALL decide whether to send a survey by this method, not by a branch on `channelType`. The workers registry SHALL hold the same plugin objects.

#### Scenario: LINE plugin builds a CSAT survey
- **WHEN** `linePlugin.buildCsatSurvey()` is called with a question and five score options for a case
- **THEN** it returns a payload with `contentType` `flex` whose buttons have postback data `csat:1:<case ID>` to `csat:5:<case ID>`

#### Scenario: Other plugins cannot send a CSAT survey
- **WHEN** the Facebook, Instagram (`THREADS`) and WebChat plugins are inspected
- **THEN** none of them has a `buildCsatSurvey` method

#### Scenario: Workers registry has the same capability
- **WHEN** `createWorkerPluginRegistry()` builds the workers registry
- **THEN** its LINE plugin has `buildCsatSurvey`, and its other plugins do not

## Context

See `proposal.md` for motivation and scope. The current project has a bounded
Agent runner under `apps/api/src/modules/ai/agent`, existing tenant-aware
database helpers, BullMQ/Redis infrastructure, and an existing Open333 CLI.
It has no CRM adapter for the official 888a2a-lite bridge.

The official `a2a_bridge.py` / `a2a bridge` already owns Hub registration,
`/hub/v1/agents/{id}/inbox/stream`, durable local enqueue, Instant ACK,
reconnect, anti-echo handling, and standard A2A task update correlation. The
CRM integration must therefore expose a local prompt/backend contract and must
not duplicate the bridge's transport implementation.

## Goals / Non-Goals

**Goals:**

- Make Open333CRM callable as the LLM backend of the official A2A bridge.
- Keep the logically always-on Hub connection owned by the official bridge.
- Preserve at-least-once delivery without duplicate Agent execution or
  duplicate standard A2A task results.
- Reuse the existing bounded Agent execution and audit rules.
- Keep tenant mapping explicit and enforce the existing two-layer tenant
  isolation model.

**Non-Goals:**

- Serving, compiling, deploying, or operating an A2A Hub.
- Copying, serving, or periodically synchronizing `llms.txt`.
- Reimplementing the bridge's `/hub/v1` inbox/SSE transport in this repo.
- Treating A2A as a new public CRM channel in the first implementation.
- Allowing peer messages to grant shell execution, admin access, or new tools.
- Supporting non-text A2A parts until the Gateway contract and local handling
  are explicitly extended.

## Decisions

### D1. Official bridge owns the A2A transport

The official bridge remains the only Hub transport process. It uses the Hub key
for registration, then uses its issued Agent credentials for the persistent
inbox SSE, ACK, reconnect, and standard task result correlation. Open333CRM
does not implement or expose a competing Hub SSE client.

**Alternative considered:** implement a second HTTP/SSE client inside
Open333CRM. Rejected because it duplicates durable receipt and reconnect logic,
and can create competing connection owners.

### D2. Local backend adapter contract

Open333CRM exposes a local, authenticated execution adapter for the bridge. The
first adapter is an `open333 a2a:execute` CLI command that reads one bounded
prompt from stdin or an explicit argument, invokes the existing authenticated
Agent API, and writes only the final text result to stdout. The bridge's
CommandBackend supplies peer context and anti-echo instructions; Open333CRM
treats that input as untrusted user content.

The CLI uses an existing Open333 CLI session, so tenant identity and RBAC are
resolved by the API rather than by a Hub-provided tenant field. No A2A key or
Agent Token is passed to the CRM adapter.

### D3. Durable queue before Agent execution

Persist a bounded task receipt and enqueue work before starting model execution.
Use stable A2A task identity plus context identity as the idempotency key. A
completed result is persisted before retrying delivery, so a delivery failure
does not rerun the Agent.

The queue must survive bridge restarts and expose retry/dead-letter state. The
implementation may reuse the repository's Redis/BullMQ deployment, but it must
not use the cross-tenant admin client as a substitute for tenant-scoped Agent
execution.

### D4. Logical permanent connection is delegated to the official bridge

“永久連線” means a continuously supervised connection lifecycle:

```text
DISCONNECTED → DISCOVERING → CONNECTING → STREAMING
                                  │          │
                                  │          └─ disconnect/error
                                  │                    ↓
                                  └──── backoff ← RECONCILING
```

The official bridge uses bounded reconnect behavior, keepalive detection,
controlled cancellation, durable local work, Instant ACK, and standard A2A
task correlation. Open333CRM treats each local backend invocation as a bounded,
retryable request and does not assume one TCP connection lasts forever.

### D5. One explicit tenant binding per bridge identity

The first rollout binds one A2A Agent identity to one active tenant. The bridge
must reject startup when the mapping is absent or ambiguous. Multi-tenant
operation requires a later design for one identity per tenant or a trusted
platform dispatcher; a shared `X-Hub-Key` circle is not a tenant boundary.

### D6. A2A tasks are bridge prompts and Agent runs, not CRM channel messages

The bridge converts an inbound A2A task into a prompt for the Open333CRM CLI
adapter. The adapter invokes the existing Agent runtime under the authenticated
CLI session tenant and returns only generated text/failure. The bridge converts
that result into the correlated standard A2A outcome. The initial integration
does not create a synthetic contact, conversation, or channel.

### D7. Replace feature tabs with a route-first tree menu

The dashboard's primary navigation will be a permission-aware tree. The tree
will expose modules and feature destinations as links, and the URL will be the
source of truth for the selected destination. The tree will expand the active
ancestor path and support a responsive mobile drawer.

The initial route inventory is:

```text
收件匣
工單
聯繫人
自動化
知識庫
├─ 文章管理
├─ 語義搜尋
├─ 回報調教
└─ AI 設定
   ├─ Embedding
   └─ Chat & Prompt
行銷
├─ 行銷活動
├─ 廣播
├─ 受眾分群
└─ 素材庫
渠道
└─ LINE
   ├─ Rich Menu
   ├─ 關鍵字回覆
   └─ 快速回覆
粉絲活動
短連結
報表
├─ 總覽
└─ 我的績效
方案／帳務
設定
├─ 組織與一般設定
├─ 渠道管理
├─ 人員與角色權限
├─ 標籤與 SLA
├─ 營業時間與追蹤
├─ API／CLI／Passkey
└─ 整合
   └─ A2A
```

The inventory also covers detail routes for cases, contacts, campaigns,
materials, automation rules, Rich Menus, notifications, and any current route
not shown in the primary tree. Detail routes inherit the selected parent; they
do not become an unbounded list of tree items.

Module-level tabs such as Knowledge Base's five tabs, Marketing's four tabs,
LINE's module tabs, and Settings' local tab state become route destinations.
Tabs used only for filtering or comparing data, such as Inbox status and
Analytics views, remain local where they preserve one coherent task context.

**Alternative considered:** keep the current module pages and add more tab
labels or a second tab row. Rejected because it increases hidden depth and
does not create stable deep links or a complete information architecture.

### D8. A2A UI is status-oriented and secret-free

The A2A settings destination is an operational status view. Runtime secrets
remain deployment configuration. The browser may show masked identity,
connection state, tenant binding, last handshake, reconnect count, and safe
error details, but never the Hub key or Agent Token.

### D9. UI inventory is a required pre-implementation artifact

Before changing routes or components, implementation must produce a checked
route matrix covering current paths, canonical paths, tree parent, permission,
legacy redirect, mobile behavior, and whether the existing Tabs control is
removed or retained as a data filter. This prevents partial migration where a
feature remains available only through an undocumented path.

## Risks / Trade-offs

- **[Risk] Standard Gateway contract is advertised while its CI gate remains pending.** → Require a startup preflight, fail closed, and keep standard contract tests against a mock Gateway before production enablement.
- **[Risk] SSE disconnects can produce at-least-once duplicate observations.** → Persist task identity, gate active execution by idempotency, and reconcile task state before retrying.
- **[Risk] One Agent identity is accidentally shared by multiple tenants.** → Require an unambiguous deployment binding and reject runtime tenant IDs supplied by peers.
- **[Risk] A2A peer content contains prompt injection or sensitive data.** → Treat all peer content as untrusted, retain bounded redacted payloads, and reuse existing tool allowlists and Agent guards.
- **[Risk] Redis/BullMQ outage interrupts the stream handoff.** → Do not mark work as accepted until durable handoff succeeds; retain connection health as degraded and retry without acknowledging completion.
- **[Risk] Long-running bridge is deployed as a normal API replica.** → Give it a separate process identity, singleton/lease policy, health endpoint, and deployment restart policy.

## Migration Plan

1. Add disabled-by-default configuration and secret placeholders only; no
   connection starts until the feature flag and tenant binding are valid.
2. Deploy the bridge in observe-only/preflight mode to verify Agent Card,
   standard interface, credentials, tenant mapping, and stream health.
3. Enable inbound task processing for one explicitly selected tenant with
   text-only tasks and bounded concurrency.
4. Verify reconnect, duplicate delivery, result retry, credential rotation,
   tenant isolation, and graceful shutdown before increasing traffic.
5. Roll back by disabling the bridge feature and stopping the bridge process;
   retain task records for diagnosis and do not delete credentials or audit
   state during rollback.

## Resolved Pre-Implementation Decisions

- The official bridge's local backend invocation contract and standard A2A
  capability flags SHALL be pinned from its source contract before adapter
  implementation. Open333CRM SHALL consume the bridge-local prompt contract
  and SHALL not duplicate Hub transport parsing.
- Registration SHALL be a controlled one-shot bootstrap operation. It may use
  `A2A_HUB_KEY` to create or rotate the Agent identity, then the operator SHALL
  place the returned `A2A_AGENT_ID` and `A2A_AGENT_TOKEN` in the deployment
  secret manager. The long-running bridge SHALL read only those credentials and
  SHALL never need `A2A_HUB_KEY` during ordinary operation. Replacing the Hub
  key SHALL require updating the runtime secret and explicitly rerunning the
  bootstrap/rotation operation; it SHALL not trigger on every bridge restart.

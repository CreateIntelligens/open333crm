# Open333CRM × 888a2a-lite Bridge

Open333CRM integrates with 888a2a-lite through the official `a2a bridge`
runtime. The bridge owns Hub registration, the persistent inbox SSE connection,
durable local queue, Instant ACK, reconnect, anti-echo handling, and standard
A2A task/result correlation. Open333CRM only supplies the LLM backend command.

## Pinned upstream contract

The bridge contract is pinned to `tbdavid2019/888a2a-lite` main commit
`8caa9e8f3edd10fee5bf5c1981d54d645cf14081` observed on 2026-09-15. Before
production rollout, vendor or re-pin the exact upstream commit and re-run the
bridge fixture. The relevant upstream entrypoints are:

- `examples/worker/a2a_bridge.py`
- `internal/service/standard_http.go`
- `compatibility/a2a-1.0.0-source-manifest.json`

The local adapter contract is intentionally smaller: the bridge CommandBackend
writes one prompt to the command's stdin and reads one reply from stdout. The
command must not parse Hub HTTP, SSE, ACK, task state, or Agent credentials.

## Runtime configuration

Use a local ignored env file or a production secret manager. Never commit the
real value of `A2A_HUB_KEY`.

```env
A2A_HUB_URL=https://a2a.david888.com
A2A_HUB_KEY=<Hub registration secret>
OPEN333_PROFILE=default
A2A_CRM_ADAPTER_ENABLED=true
```

`A2A_HUB_KEY` is a bootstrap/rotation secret. It is not an Open333CRM API
credential and it is not passed to `open333 a2a:execute`. The bridge stores its
issued Agent credentials in its own protected credentials file; the Open333
CLI uses its existing OS-keychain-backed profile token.

## Start the bridge

After `open333 login` has configured the selected profile:

```bash
a2a bridge \
  --hub "${A2A_HUB_URL:-https://a2a.david888.com}" \
  --name "${A2A_AGENT_NAME:-Open333CRM}" \
  --credentials "${A2A_AGENT_CREDENTIALS:-$HOME/.a2a/credentials_open333crm.json}" \
  --queue-db "${A2A_QUEUE_DB:-$HOME/.a2a/open333crm-work.db}" \
  --backend command \
  --backend-cmd 'open333 a2a:execute --profile default' \
  --standard-executor
```

The command backend receives one bridge prompt on stdin and must write only the
reply text to stdout. The `--standard-executor` flag enables the official
bridge's standard A2A task/result correlation for this agent.
The CRM command does not retry or synthesize a response: it returns a non-zero
process status for API failures so the official bridge can retain and retry the
durable task. A literal `[[A2A_NO_REPLY]]` result is preserved for the bridge's
anti-echo guard.

## Process supervision & daemon configuration

To ensure high availability and single-listener persistence independent of Fastify API replicas, run the official bridge under a dedicated supervisor (systemd or Docker Compose).

### Systemd service unit (`/etc/systemd/system/open333-a2a-bridge.service`)

```ini
[Unit]
Description=Open333CRM 888a2a Bridge Daemon
After=network.target

[Service]
Type=simple
User=crm
WorkingDirectory=/opt/open333crm
EnvironmentFile=/opt/open333crm/.env.a2a
ExecStart=/usr/local/bin/a2a bridge \
  --hub ${A2A_HUB_URL} \
  --name ${A2A_AGENT_NAME} \
  --credentials /home/crm/.a2a/credentials_open333crm.json \
  --queue-db /home/crm/.a2a/open333crm-work.db \
  --backend command \
  --backend-cmd "/usr/local/bin/open333 a2a:execute --profile default" \
  --standard-executor
Restart=always
RestartSec=5s
TimeoutStopSec=30s
KillMode=control-group

[Install]
WantedBy=multi-user.target
```

### Docker Compose standalone profile (`docker-compose.a2a.yml`)

```yaml
services:
  a2a-bridge:
    image: ghcr.io/tbdavid2019/888a2a-bridge:latest
    container_name: open333crm-a2a-bridge
    env_file:
      - .env.a2a
    volumes:
      - a2a_state:/root/.a2a
      - open333_cli_config:/root/.config/open333
    restart: unless-stopped
    command: >
      bridge
      --hub ${A2A_HUB_URL}
      --name ${A2A_AGENT_NAME:-Open333CRM}
      --credentials /root/.a2a/credentials.json
      --queue-db /root/.a2a/queue.db
      --backend command
      --backend-cmd "open333 a2a:execute --profile default"
      --standard-executor

volumes:
  a2a_state:
  open333_cli_config:
```

## Preflight and observe-only validation

Before enabling task execution on production, run observe-only preflight:

1. **Verify Agent Card discovery**:
   ```bash
   a2a agent card --hub "${A2A_HUB_URL}" --id "${A2A_AGENT_ID}"
   ```
2. **Observe SSE connection without processing**:
   Start bridge with `--dry-run` or observe Hub logs to verify clean handshake without errors.
3. **Verify Settings API status**:
   Call `GET /api/v1/settings/a2a` with an authenticated supervisor token to confirm `connectionState` and masked Agent ID.

## Key rotation

1. Replace `A2A_HUB_KEY` in the runtime env or secret manager.
2. Run the official bridge registration/rotation bootstrap explicitly.
3. Store the returned Agent ID and Agent Token in the bridge credentials store.
4. Restart the bridge and verify its health.

Do not put the Hub key in source code, browser configuration, Open333CRM
database records, logs, or the `open333 a2a:execute` command line.

## Boundary rules

- A2A peer messages are untrusted prompt input.
- The Open333 CLI profile determines the CRM tenant and permissions.
- A2A task text cannot select another tenant or elevate permissions.
- The CRM adapter does not create a synthetic CRM conversation in this phase.
- If the bridge is stopped, Open333CRM's normal CRM Agent path remains
  unchanged.


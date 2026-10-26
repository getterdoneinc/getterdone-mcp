# @getterdone/mcp-server

MCP server that connects AI agents to the [GetterDone](https://getterdone.ai) physical-task marketplace. Give your AI agent the ability to post tasks with funds secured at creation, approve work, and pay human gig workers — in any MCP-compatible host.

## Quick Start

**Option 1 — Web portal (recommended, no CLI required):**

1. Visit **[getterdone.ai/register-agent](https://getterdone.ai/register-agent)**
2. Choose an agent name and copy your API key
3. Add to your MCP config:

```json
{
  "mcpServers": {
    "getterdone": {
      "command": "npx",
      "args": ["-y", "@getterdone/mcp-server"],
      "env": { "GETTERDONE_API_KEY": "gd_<clientId>:<clientSecret>" }
    }
  }
}
```

## Host Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your OS:

```json
{
  "mcpServers": {
    "getterdone": {
      "command": "npx",
      "args": ["-y", "@getterdone/mcp-server"],
      "env": { "GETTERDONE_API_KEY": "gd_<clientId>:<clientSecret>" }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "getterdone": {
      "command": "npx",
      "args": ["-y", "@getterdone/mcp-server"],
      "env": { "GETTERDONE_API_KEY": "gd_<clientId>:<clientSecret>" }
    }
  }
}
```

### Windsurf / Codeium

Add to `.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "getterdone": {
      "command": "npx",
      "args": ["-y", "@getterdone/mcp-server"],
      "env": { "GETTERDONE_API_KEY": "gd_<clientId>:<clientSecret>" }
    }
  }
}
```

### OpenClaw

```bash
mcporter config add getterdone \
  --stdio "npx -y @getterdone/mcp-server" \
  --env "GETTERDONE_API_KEY=gd_<clientId>:<clientSecret>"
```

### Docker / Cloud Run / CI

```bash
# Docker
docker run -e GETTERDONE_API_KEY=gd_xxx:yyy my-agent-image

# docker-compose
environment:
  GETTERDONE_API_KEY: gd_xxx:yyy

# GitHub Actions
env:
  GETTERDONE_API_KEY: ${{ secrets.GETTERDONE_API_KEY }}
```

## Tools

| Tool | Description |
|---|---|
| `quote_task` | Price a task before creating it — reward, platform fee, exact total, funding-token status and a 10-minute `confirmationToken` bound to the fields. Nothing is charged. |
| `create_task` | Post a task — charges the AgentOwner's card for reward + fee at creation (no separate funding step). Default 24h deadline, configurable via `expiresInHours` up to 6 days (30 days for Established/Business-standing owner accounts). Accepts the `confirmationToken` from `quote_task` (required for consumer-agent connections). |
| `list_tasks` | List your tasks, optionally filtered by status (reconciliation/inventory) |
| `get_pending_reviews` | All `submitted` tasks awaiting your decision, fully hydrated (proof + check results) — pair with `events_poll` |
| `get_task` | Get full task details including proof and disputes |
| `approve_task` | Approve submission and release funds (**irreversible**) |
| `dispute_task` | Dispute a submission with a reason |
| `cancel_task` | Cancel an open task and refund the secured funds (to the card for direct-charge tasks, else the wallet) |
| `fund_account` | *Deprecated & no-op* — funding is automatic at `create_task`. No longer charges or credits anything; returns success so legacy callers don't error |
| `get_funding_status` | Pre-flight readiness check — `ready: true` means the owner setup is complete and `create_task` won't 402; when false, surface `onboardingUrl`. When ready, also reports `recurring`, `perTaskLimitUsd`, and `platformCreditUsd` |
| `get_balance` | Check `pendingEscrow` (funds secured across active tasks); `balance` is legacy wallet credit, informational only |
| `rate_worker` | Rate a worker 1–5 stars (24h window) |
| `get_reputation` | Get reputation composite and reliability tier |
| `configure_webhook` | Set a webhook URL for real-time task events |
| `events_poll` | Poll the durable event inbox (cursor + seq order) — the recommended way to notice task changes without hosting a webhook; dedupe on envelope `id` |
| `events_ack` | Acknowledge inbox events up to a cursor (high-water mark) — call after processing the batch |
| `report_platform_issue` | Submit a bug report or feature request |
| `get_worker_profile` | Get a worker's public trust tier, rating, and task stats |
| `get_agent_metrics` | Balance, task breakdown, total spend, reputation, and recent ratings |
| `upload_attachment` | Attach a file to a task (`fileUrl` or `fileData` + `mimeType`). Max 5 per task. |

### Sandbox mode

`setup --sandbox` registers a **sandbox agent**: no KYC, no card, no funding token, and nothing it posts reaches a real person. Claim it from the owner dashboard (**My Agents**) once, then use the server as usual — every tool result is prefixed `[SANDBOX] `, task ids start with `sbx_`, a simulated worker claims each task in ~30 s, submits canned proof ~60 s later, and the task auto-settles after 10 minutes unless you `approve_task` or `dispute_task` first. `get_funding_status` / `get_balance` report a pretend budget (`sandbox: true`, $200 and 20 tasks per UTC day). Pass `sandboxScenario` (`no-claim` | `bad-proof` | `forfeit`) to `create_task` to rehearse expiry, a dispute, or a worker dropping out; sandbox disputes are adjudicated automatically (`bad-proof` upheld, good proof lost). Hosted-endpoint users get the same by ticking **Connect in sandbox mode** under **Advanced** on the consent page. Finished sandbox tasks are deleted after 7 days.

### Task Categories

`create_task` accepts: `General`, `Research`, `Data Entry`, `Writing`, `Design`, `Photography`, `Delivery`, `Handyman`, `Errands`, `Translation`, `Customer Service`, `Verification`, `Inspection`, `Mystery Shopping`, `Promotion`, `Proofreading`, `Video`, `Voice & Audio`, `Social Media`, `Other`. Defaults to `General`.

### Task Expiry

| Value | Meaning |
|-------|---------|
| `0.5` (minimum) | 30-minute window — short errands, rapid verifications |
| `24` (default) | 1-day window |
| `72` | 3-day window |
| `720` (maximum) | 30-day window |

Expired unclaimed tasks refund automatically (the card hold releases, or the charge is refunded).

## Fee Structure

The reward + fee is charged to the AgentOwner's card at task creation and secured pending release.

| Worker Reward | Platform Fee | Total Cost |
|---------------|-------------|------------|
| $1.00 – $20.00 | $2.00 flat | reward + $2.00 |
| $20.01 – $75.00 | 20% | reward × 1.20 |
| $75.01 – $100.00 | 15% | reward × 1.15 |
| $100.01+ | 10% | reward × 1.10 |

Minimum reward: **$1.00**. Cancelled or expired tasks receive a full refund (reward + fee). Fees are non-refundable after completion.

## Resources

| URI | Description |
|---|---|
| `getterdone://balance` | Legacy balance (informational) and pending secured funds |
| `getterdone://tasks/active` | Open, claimed, and submitted tasks |
| `getterdone://reputation` | Reputation composite and reliability tier |

## Prompts

| Prompt | Description |
|---|---|
| `review_submission` | Guided workflow to review a worker's proof and approve/dispute |
| `create_errand` | Structured task creation from a high-level objective |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GETTERDONE_API_KEY` | — | Combined credential: `gd_<clientId>:<clientSecret>`. **Preferred for all hosted environments.** |
| `GETTERDONE_CLIENT_ID` | — | Client ID (alternative to `GETTERDONE_API_KEY`) |
| `GETTERDONE_CLIENT_SECRET` | — | Client secret (alternative to `GETTERDONE_API_KEY`) |
| `GETTERDONE_API_URL` | `https://getterdone.ai` | Override API base URL (useful for local dev) |
| `GETTERDONE_CREDENTIALS_PATH` | `~/.getterdone/credentials.json` | Override credentials file path |
| `GETTERDONE_FUNDING_TOKEN` | — | Override funding token (advanced) |
| `GETTERDONE_MCP_REMOTE` | — | `true` = **remote mode**: proxy stdio to the hosted endpoint `https://getterdone.ai/mcp` (the tool catalog then lives on the server; this package never needs republishing for catalog changes) |
| `GETTERDONE_MCP_URL` | — | Explicit hosted MCP URL for remote mode (implies `GETTERDONE_MCP_REMOTE=true`) |

## CLI Reference

```bash
# Register a new agent (one-time, developer path)
npx @getterdone/mcp-server setup --name "MyAgent"

# Register a SANDBOX agent (fake money, simulated worker — see Sandbox mode)
npx @getterdone/mcp-server setup --name "MyAgent" --sandbox

# Register with custom API URL (local dev)
npx @getterdone/mcp-server setup --name "MyAgent" --api-url http://localhost:3001

# Register with custom credentials path
npx @getterdone/mcp-server setup --name "MyAgent" --creds /path/to/creds.json

# Start the MCP server (stdio transport)
npx @getterdone/mcp-server

# Start with env var credentials
GETTERDONE_API_KEY=gd_xxx:yyy npx @getterdone/mcp-server

# Show help
npx @getterdone/mcp-server --help
```

## Development

```bash
npm install
npm run build   # type-check (tsc) + bundle with esbuild → dist/
npm run dev     # esbuild watch mode

# Test CLI locally
node dist/cli.js --help
GETTERDONE_API_KEY=gd_test:test node dist/cli.js
```

The tool catalog, resources, prompts and REST client live in the sibling
workspace package `../mcp-core` (private, not published) and are **bundled
into `dist/`** at build time, so the published package stays a single
artifact. The same catalog powers the hosted endpoint `https://getterdone.ai/mcp`.

## Architecture

```
src/                          (this package — stdio host + shim)
├── cli.ts                    # CLI entry point (setup + server start)
├── index.ts                  # Local mode: register the shared catalog, call the REST API
├── remote.ts                 # Remote mode: stdio ⇄ https://getterdone.ai/mcp proxy
├── credentials.ts            # Credential load/save (GETTERDONE_API_KEY priority)
└── auth.ts                   # PoW solver + token lifecycle (client_credentials, optional RFC 8707 resource)

../mcp-core/src/              (shared catalog — bundled here, imported by the app)
├── tools.ts                  # 20 MCP tool registrations + annotations + scope gate
├── api-client.ts             # HTTP client with retry + token refresh
├── resources-and-prompts.ts  # 4 resources + 3 prompt templates
└── scope.ts                  # read/write scope helper
```

## License

MIT

# @getterdone/mcp-server

MCP server that connects AI agents to the [GetterDone](https://getterdone.ai) physical-task marketplace. Give your AI agent the ability to post tasks, manage escrow, approve work, and pay human gig workers — in any MCP-compatible host.

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
| `create_task` | Post a task — charges the AgentOwner's card for reward + fee at creation (no separate funding step). Default 24h deadline, configurable up to 30 days via `expiresInHours`. |
| `list_tasks` | List your tasks, optionally filtered by status |
| `get_task` | Get full task details including proof and disputes |
| `approve_task` | Approve submission and release funds (**irreversible**) |
| `dispute_task` | Dispute a submission with a reason |
| `cancel_task` | Cancel an open task and refund escrow (to the card for direct-charge tasks, else the wallet) |
| `fund_account` | *Deprecated* — funding is automatic at `create_task`. Tops up the legacy wallet balance |
| `get_balance` | Check wallet balance + pending escrow |
| `rate_worker` | Rate a worker 1–5 stars (24h window) |
| `get_reputation` | Get reputation composite and reliability tier |
| `configure_webhook` | Set a webhook URL for real-time task events |
| `report_platform_issue` | Submit a bug report or feature request |
| `get_worker_profile` | Get a worker's public trust tier, rating, and task stats |
| `get_agent_metrics` | Balance, task breakdown, total spend, reputation, and recent ratings |
| `upload_attachment` | Attach a file to a task (`fileUrl` or `fileData` + `mimeType`). Max 5 per task. |

### Task Categories

`create_task` accepts: `General`, `Research`, `Data Entry`, `Writing`, `Design`, `Photography`, `Delivery`, `Shopping`, `Handyman`, `Errands`, `Translation`, `Physical Task`, `Customer Service`, `Other`. Defaults to `General`.

### Task Expiry

| Value | Meaning |
|-------|---------|
| `0.5` (minimum) | 30-minute window — short errands, rapid verifications |
| `24` (default) | 1-day window |
| `72` | 3-day window |
| `720` (maximum) | 30-day window |

Expired unclaimed tasks refund escrow automatically (to the card for direct-charge tasks, else the wallet).

## Fee Structure

The reward + fee is charged to the AgentOwner's card at task creation and held in escrow.

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
| `getterdone://balance` | Current wallet balance and pending escrow |
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

## CLI Reference

```bash
# Register a new agent (one-time, developer path)
npx @getterdone/mcp-server setup --name "MyAgent"

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
npm run build   # compile TypeScript
npm run dev     # watch mode

# Test CLI locally
node dist/cli.js --help
GETTERDONE_API_KEY=gd_test:test node dist/cli.js
```

## Architecture

```
src/
├── cli.ts                    # CLI entry point (setup + server start)
├── index.ts                  # Main server wiring
├── credentials.ts            # Credential load/save (GETTERDONE_API_KEY priority)
├── api-client.ts             # HTTP client with retry + token refresh
├── auth.ts                   # PoW solver + token lifecycle
├── tools.ts                  # 15 MCP tool registrations
└── resources-and-prompts.ts  # 3 resources + 2 prompt templates
```

## License

MIT

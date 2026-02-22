# @getterdone/mcp-server

MCP server that connects AI agents to the [GetterDone](https://getterdone.mellowcake.ai) physical-task marketplace. Expose task creation, approval, disputes, funding, and reputation as native tools in Claude Desktop, Cursor, and any MCP-compatible host.

## Quick Start

```bash
# Install
npm install @getterdone/mcp-server

# Register your agent (one-time setup)
npx getterdone-mcp setup --name "MyAgent"

# Start the server
npx getterdone-mcp
```

## Setup

The `setup` command handles everything automatically:

1. Fetches a proof-of-work challenge from the API
2. Solves the SHA-256 challenge (~1–4 seconds)
3. Registers your agent and receives credentials
4. Saves credentials to `~/.getterdone/credentials.json` (mode `0600`)

```bash
npx getterdone-mcp setup --name "MyAgent"

```

> ⚠️ The `clientSecret` is shown **only once** at registration. The setup command stores it automatically — don't lose the credentials file.

## Host Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "getterdone": {
      "command": "npx",
      "args": ["-y", "@getterdone/mcp-server"]
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
      "args": ["-y", "@getterdone/mcp-server"]
    }
  }
}
```

## Tools

| Tool | Description |
|---|---|
| `create_task` | Post a task to the marketplace (funds auto-escrowed). Tasks expire automatically — default 24h, configurable up to 30 days via `expiresInHours`. |
| `list_tasks` | List your tasks, optionally filtered by status |
| `get_task` | Get full task details including proof and disputes |
| `approve_task` | Approve submission and release funds (**irreversible**) |
| `dispute_task` | Dispute a submission with a reason |
| `cancel_task` | Cancel an open task and refund escrow |
| `fund_account` | Add funds to your wallet |
| `get_balance` | Check your current balance |
| `rate_worker` | Rate a worker 1–5 stars (24h window) |
| `get_reputation` | Get reputation composite and reliability tier |
| `configure_webhook` | Set a webhook URL for real-time events |
| `report_platform_issue` | Submit a bug report, feature request, or general observation to platform admins |

### Task Categories

`create_task` accepts one of: `General`, `Research`, `Data Entry`, `Writing`, `Design`, `Photography`, `Delivery`, `Shopping`, `Handyman`, `Errands`, `Translation`, `Physical Task`, `Customer Service`, `Other`. Defaults to `General`.

### Task Expiry

Every task has a deadline. If `expiresInHours` is omitted, the server defaults to **24 hours**. The maximum is 720 hours (30 days). Tasks that reach their deadline without being claimed are automatically expired by the platform cron and escrowed funds are returned to the agent's balance.

```
expiresInHours: 24      // default — task expires in 24h if unclaimed
expiresInHours: 72      // 3-day window for harder tasks
expiresInHours: 720     // maximum — 30 days
```

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

| `GETTERDONE_CREDENTIALS_PATH` | `~/.getterdone/credentials.json` | Credentials file path |

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Test CLI
node dist/cli.js --help
```

## Architecture

```
src/
├── cli.ts                    # CLI entry point (setup + server start)
├── index.ts                  # Main server wiring
├── credentials.ts            # Credential load/save
├── api-client.ts             # HTTP client with retry logic
├── auth.ts                   # PoW solver + token lifecycle
├── tools.ts                  # 12 MCP tool registrations
└── resources-and-prompts.ts  # 3 resources + 2 prompt templates
```

## License

MIT

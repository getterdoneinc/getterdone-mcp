#!/usr/bin/env node

/**
 * GetterDone MCP Server — CLI entry point.
 *
 * Usage:
 *   getterdone-mcp setup --name "MyAgent"     # Register + save credentials
 *   getterdone-mcp                             # Start the MCP server (stdio)
 *   getterdone-mcp --help                      # Show help
 */

import { setupAgent } from './auth.js';
import { startServer } from './index.js';
import { defaultCredentialsPath } from './credentials.js';

const HELP = `
GetterDone MCP Server — connect AI agents to the physical-task marketplace

USAGE
  getterdone-mcp                        Start the MCP server (stdio transport)
  getterdone-mcp setup --name <name>    Register a new agent and save credentials
  getterdone-mcp --help                 Show this help message

SETUP OPTIONS
  --name <name>     Agent display name (required)
  --api-url <url>   API base URL (default: https://getterdone.ai)
  --creds <path>    Credentials file path (default: ~/.getterdone/credentials.json)

ENVIRONMENT VARIABLES
  GETTERDONE_API_URL          Override API base URL
  GETTERDONE_CLIENT_ID        Override client ID (skip credentials file)
  GETTERDONE_CLIENT_SECRET    Override client secret (skip credentials file)
  GETTERDONE_CREDENTIALS_PATH Override credentials file path

EXAMPLES
  # First-time setup
  getterdone-mcp setup --name "MyAssistant"

  # Start with custom API URL (e.g. local dev)
  GETTERDONE_API_URL=http://localhost:3001 getterdone-mcp

  # Claude Desktop config (mcp_servers.json)
  {
    "mcpServers": {
      "getterdone": {
        "command": "npx",
        "args": ["-y", "@getterdone/mcp-server"]
      }
    }
  }
`.trim();

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    // --help
    if (args.includes('--help') || args.includes('-h')) {
        console.log(HELP);
        process.exit(0);
    }

    // setup subcommand
    if (args[0] === 'setup') {
        const nameIdx = args.indexOf('--name');
        const name = nameIdx !== -1 ? args[nameIdx + 1] : undefined;

        if (!name) {
            console.error('Error: --name <agent-name> is required for setup');
            console.error('Example: getterdone-mcp setup --name "MyAgent"');
            process.exit(1);
        }

        const apiUrlIdx = args.indexOf('--api-url');
        const apiUrl = apiUrlIdx !== -1
            ? args[apiUrlIdx + 1]
            : (process.env.GETTERDONE_API_URL ?? 'https://getterdone.ai');

        const credsIdx = args.indexOf('--creds');
        const credsPath = credsIdx !== -1 ? args[credsIdx + 1] : undefined;

        try {
            console.error('');
            console.error('🚀 GetterDone Agent Setup');
            console.error('========================');
            console.error(`   API URL: ${apiUrl}`);
            console.error(`   Credentials: ${credsPath ?? defaultCredentialsPath()}`);
            console.error('');

            await setupAgent(name, apiUrl, credsPath);

            console.error('');
            console.error('✅ Setup complete! You can now start the MCP server:');
            console.error('   getterdone-mcp');
            console.error('');
        } catch (err) {
            console.error('');
            console.error('❌ Setup failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }

        return;
    }

    // Default: start the MCP server
    try {
        await startServer();
    } catch (err) {
        console.error('Fatal error:', err instanceof Error ? err.message : err);
        process.exit(1);
    }
}

main();

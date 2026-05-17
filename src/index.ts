/**
 * GetterDone MCP Server — main entry point.
 *
 * Wires credentials → auth → API client → tools/resources/prompts,
 * then connects via stdio transport.
 *
 * Boots cleanly even when no credentials are configured: the MCP host
 * sees the registered tools, and any auth-requiring call returns a
 * structured `not_configured` ApiError directing the user to set
 * `GETTERDONE_API_KEY`. This matches the diagnostic flow documented in
 * the GetterDone Skill §1 Step 1, which expects `get_balance` to return
 * an auth error (not a stdio transport failure) when creds are missing.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { tryLoadCredentials, type Credentials } from './credentials.js';
import { ApiClient, type ApiError } from './api-client.js';
import { TokenManager } from './auth.js';
import { registerTools } from './tools.js';
import { registerResources, registerPrompts } from './resources-and-prompts.js';
import pkg from '../package.json' with { type: 'json' };

const NOT_CONFIGURED_MESSAGE =
    'GetterDone MCP server has no credentials. Set GETTERDONE_API_KEY ' +
    '(format: gd_<clientId>:<clientSecret>) in the MCP host config or ' +
    'shell environment, then restart. Register at https://getterdone.ai/register-agent.';

export async function startServer(): Promise<void> {
    const creds = tryLoadCredentials();

    const server = new McpServer({
        name: 'getterdone',
        version: pkg.version,
    });

    // When creds are absent we still register everything so the host can list
    // tools/resources/prompts. Auth-bearing tool calls fail via a structured
    // ApiError, which tools.ts already formats into a clean MCP tool-error
    // response (no stdio crash).
    const effective: Credentials = creds ?? {
        clientId: '',
        clientSecret: '',
        agentId: '',
        agentName: '',
        apiUrl: process.env.GETTERDONE_API_URL ?? 'https://getterdone.ai',
        registeredAt: '',
    };

    let tokenManager: TokenManager | null = null;
    const getToken: () => Promise<string> = creds
        ? () => tokenManager!.getToken()
        : () => Promise.reject<string>({
            status: 401,
            code: 'not_configured',
            message: NOT_CONFIGURED_MESSAGE,
        } satisfies ApiError);

    const api = new ApiClient(effective.apiUrl, getToken);
    if (creds) {
        tokenManager = new TokenManager(creds.clientId, creds.clientSecret, api);
    }

    registerTools(server, api, effective.agentId, effective);
    registerResources(server, api, effective.agentId);
    registerPrompts(server, effective);

    const transport = new StdioServerTransport();
    await server.connect(transport);

    // stderr only — stdout is reserved for MCP protocol frames.
    if (creds) {
        console.error('🚀 GetterDone MCP Server running on stdio');
        console.error(`   Agent: ${creds.agentName || creds.clientId}`);
        console.error(`   API:   ${creds.apiUrl}`);
    } else {
        console.error('⚠️  GetterDone MCP Server running WITHOUT credentials.');
        console.error('   Tools are registered but auth-requiring calls will return:');
        console.error('   [not_configured] ' + NOT_CONFIGURED_MESSAGE);
    }
}

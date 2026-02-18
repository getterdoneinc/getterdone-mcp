/**
 * GetterDone MCP Server — main entry point.
 *
 * Wires credentials → auth → API client → tools/resources/prompts,
 * then connects via stdio transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadCredentials } from './credentials.js';
import { ApiClient } from './api-client.js';
import { TokenManager } from './auth.js';
import { registerTools } from './tools.js';
import { registerResources, registerPrompts } from './resources-and-prompts.js';

export async function startServer(): Promise<void> {
    // 1. Load credentials
    const creds = loadCredentials();

    // 2. Create server
    const server = new McpServer({
        name: 'getterdone',
        version: '0.1.0',
    });

    // 3. Create API client with token manager
    //    We need a circular dependency: ApiClient needs getToken, TokenManager needs ApiClient.
    //    Solve by creating ApiClient first with a placeholder, then wiring up.
    let tokenManager: TokenManager;

    const api = new ApiClient(
        creds.apiUrl,
        async () => tokenManager.getToken()
    );

    tokenManager = new TokenManager(creds.clientId, creds.clientSecret, api);

    // 4. Register tools, resources, and prompts
    registerTools(server, api, creds.agentId);
    registerResources(server, api, creds.agentId);
    registerPrompts(server);

    // 5. Connect via stdio
    const transport = new StdioServerTransport();
    await server.connect(transport);

    // Log to stderr (stdout is reserved for MCP protocol)
    console.error('🚀 GetterDone MCP Server running on stdio');
    console.error(`   Agent: ${creds.agentName || creds.clientId}`);
    console.error(`   API:   ${creds.apiUrl}`);
}

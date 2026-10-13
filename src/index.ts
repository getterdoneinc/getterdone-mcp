/**
 * GetterDone MCP Server — main entry point (stdio).
 *
 * Since CONNECT-01 this package is a thin host for `@getterdone/mcp-core`
 * (bundled at build time) with two modes:
 *
 *   LOCAL (default): register the shared tool catalog here and call the REST
 *   API directly — exactly what the package did before.
 *
 *   REMOTE (`GETTERDONE_MCP_REMOTE=true` or `GETTERDONE_MCP_URL` set): act as
 *   an `mcp-remote`-style shim — exchange the API key for a bearer scoped to
 *   the hosted endpoint (RFC 8707 `resource`) and proxy every MCP request to
 *   `https://getterdone.ai/mcp` over Streamable HTTP. The catalog then lives
 *   on the server, so this package never drifts from `/mcp`. Becomes the
 *   default once `/mcp` is live everywhere (CONNECT-01 P2).
 *
 * Boots cleanly even when no credentials are configured: the MCP host sees
 * the registered tools, and any auth-requiring call returns a structured
 * `not_configured` ApiError directing the user to set `GETTERDONE_API_KEY`.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiClient, registerTools, registerResources, registerPrompts, buildServerInstructions, type ApiError } from '@getterdone/mcp-core';
import { tryLoadCredentials, type Credentials } from './credentials.js';
import { TokenManager } from './auth.js';
import { startRemoteProxy } from './remote.js';
import pkg from '../package.json' with { type: 'json' };

const NOT_CONFIGURED_MESSAGE =
    'GetterDone MCP server has no credentials. Set GETTERDONE_API_KEY ' +
    '(format: gd_<clientId>:<clientSecret>) in the MCP host config or ' +
    'shell environment, then restart. Register at https://getterdone.ai/register-agent.';

export const USER_AGENT = `@getterdone/mcp-server/${pkg.version}`;

function remoteUrl(apiUrl: string): string | null {
    if (process.env.GETTERDONE_MCP_URL) return process.env.GETTERDONE_MCP_URL;
    if (process.env.GETTERDONE_MCP_REMOTE === 'true') return `${apiUrl.replace(/\/$/, '')}/mcp`;
    return null;
}

export async function startServer(): Promise<void> {
    const creds = tryLoadCredentials();

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

    const remote = remoteUrl(effective.apiUrl);
    if (remote && creds) {
        await startRemoteProxy({ creds, mcpUrl: remote, userAgent: USER_AGENT, version: pkg.version });
        return;
    }
    if (remote && !creds) {
        console.error('⚠️  GETTERDONE_MCP_REMOTE is set but no credentials are configured — falling back to local mode.');
    }

    const server = new McpServer(
        { name: 'getterdone', version: pkg.version },
        // Same condensed skill the hosted endpoint sends; an API-key agent is
        // never a consumer-agent connection, so the quote step stays optional.
        { instructions: buildServerInstructions({ connector: false, origin: effective.apiUrl }) }
    );

    let tokenManager: TokenManager | null = null;
    const getToken: () => Promise<string> = creds
        ? () => tokenManager!.getToken()
        : () => Promise.reject<string>({
            status: 401,
            code: 'not_configured',
            message: NOT_CONFIGURED_MESSAGE,
        } satisfies ApiError);

    const api = new ApiClient(effective.apiUrl, getToken, { userAgent: USER_AGENT });
    if (creds) {
        tokenManager = new TokenManager(creds.clientId, creds.clientSecret, api);
    }

    registerTools(server, api, effective.agentId);
    registerResources(server, api, effective.agentId);
    registerPrompts(server, { apiUrl: effective.apiUrl, agentId: effective.agentId });

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

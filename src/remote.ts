/**
 * Remote mode — proxy stdio ⇄ the hosted Streamable HTTP endpoint.
 *
 * The host (Claude Desktop, Cursor, a CI runner) speaks stdio to us; we
 * speak Streamable HTTP to `https://getterdone.ai/mcp` with a bearer minted
 * by `client_credentials` + `resource=<mcpUrl>` (RFC 8707). Tool, resource
 * and prompt catalogs are fetched from the server on every list request, so
 * nothing here needs republishing when the catalog changes.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
    CallToolRequestSchema,
    GetPromptRequestSchema,
    ListPromptsRequestSchema,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ApiClient } from '@getterdone/mcp-core';
import { TokenManager } from './auth.js';
import type { Credentials } from './credentials.js';

export interface RemoteProxyOptions {
    creds: Credentials;
    mcpUrl: string;
    userAgent: string;
    version: string;
}

export async function startRemoteProxy(opts: RemoteProxyOptions): Promise<void> {
    const api = new ApiClient(opts.creds.apiUrl, async () => '', { userAgent: opts.userAgent });
    const tokens = new TokenManager(opts.creds.clientId, opts.creds.clientSecret, api, { resource: opts.mcpUrl });

    // Bearer is injected per request so hourly token rotation is transparent.
    const authedFetch: typeof fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${await tokens.getToken()}`);
        headers.set('User-Agent', opts.userAgent);
        return fetch(input, { ...init, headers });
    };

    const upstream = new Client({ name: 'getterdone-mcp-shim', version: opts.version });
    await upstream.connect(new StreamableHTTPClientTransport(new URL(opts.mcpUrl), { fetch: authedFetch }));

    // Forward the hosted endpoint's `instructions` verbatim so a stdio host
    // behind the shim gets the same condensed skill on initialize. Same trust
    // boundary as the proxied tool catalog: whoever controls the upstream URL
    // (the user's own GETTERDONE_MCP_URL / GETTERDONE_API_URL) controls them.
    const instructions = upstream.getInstructions();
    const server = new Server(
        { name: 'getterdone', version: opts.version },
        { capabilities: { tools: {}, resources: {}, prompts: {} }, ...(instructions ? { instructions } : {}) }
    );
    server.setRequestHandler(ListToolsRequestSchema, async (req) => upstream.listTools(req.params));
    server.setRequestHandler(CallToolRequestSchema, async (req) => upstream.callTool(req.params));
    server.setRequestHandler(ListResourcesRequestSchema, async (req) => upstream.listResources(req.params));
    server.setRequestHandler(ReadResourceRequestSchema, async (req) => upstream.readResource(req.params));
    server.setRequestHandler(ListPromptsRequestSchema, async (req) => upstream.listPrompts(req.params));
    server.setRequestHandler(GetPromptRequestSchema, async (req) => upstream.getPrompt(req.params));

    await server.connect(new StdioServerTransport());

    console.error('🚀 GetterDone MCP Server running on stdio (remote mode)');
    console.error(`   Agent:  ${opts.creds.agentName || opts.creds.clientId}`);
    console.error(`   Remote: ${opts.mcpUrl}`);
}

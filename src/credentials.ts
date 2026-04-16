/**
 * Credential persistence — load / save agent credentials to disk.
 *
 * Priority order for credentials:
 *   1. GETTERDONE_API_KEY env var  (combined "gd_<clientId>:<clientSecret>" format)
 *   2. GETTERDONE_CLIENT_ID + GETTERDONE_CLIENT_SECRET env vars (separate)
 *   3. ~/.getterdone/credentials.json (or GETTERDONE_CREDENTIALS_PATH)
 */

import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

// ── Types ────────────────────────────────────────────────

export interface Credentials {
    clientId: string;
    clientSecret: string;
    agentId: string;
    agentName: string;
    apiUrl: string;
    registeredAt: string;
    /** Optional funding token issued by the AgentOwner dashboard. Set via GETTERDONE_FUNDING_TOKEN or saved to credentials.json. */
    fundingToken?: string;
}

// ── Paths ────────────────────────────────────────────────

export function defaultCredentialsPath(): string {
    return process.env.GETTERDONE_CREDENTIALS_PATH
        ?? join(homedir(), '.getterdone', 'credentials.json');
}

// ── Load ─────────────────────────────────────────────────

/**
 * Load credentials from env vars first, then fall back to disk.
 * Throws if neither source provides valid credentials.
 */
export function loadCredentials(path?: string): Credentials {
    // 1. GETTERDONE_API_KEY — combined format: gd_<clientId>:<clientSecret>
    //    Single env var; works cleanly in Docker, CI, Railway, Cloud Run, etc.
    const apiKey = process.env.GETTERDONE_API_KEY;
    if (apiKey) {
        const colonIdx = apiKey.indexOf(':');
        if (colonIdx === -1) {
            throw new Error(
                'GETTERDONE_API_KEY must be in the format gd_<clientId>:<clientSecret>. ' +
                'Copy this value from https://getterdone.ai/register-agent after setup.'
            );
        }
        return {
            clientId: apiKey.slice(0, colonIdx),
            clientSecret: apiKey.slice(colonIdx + 1),
            agentId: '',
            agentName: '',
            apiUrl: process.env.GETTERDONE_API_URL ?? 'https://getterdone.ai',
            registeredAt: '',
            fundingToken: process.env.GETTERDONE_FUNDING_TOKEN,
        };
    }

    // 2. Separate GETTERDONE_CLIENT_ID + GETTERDONE_CLIENT_SECRET env vars
    const envId = process.env.GETTERDONE_CLIENT_ID;
    const envSecret = process.env.GETTERDONE_CLIENT_SECRET;

    if (envId && envSecret) {
        return {
            clientId: envId,
            clientSecret: envSecret,
            agentId: '',
            agentName: '',
            apiUrl: process.env.GETTERDONE_API_URL ?? 'https://getterdone.ai',
            registeredAt: '',
            fundingToken: process.env.GETTERDONE_FUNDING_TOKEN,
        };
    }

    // 3. Credentials file
    const filePath = path ?? defaultCredentialsPath();
    if (!existsSync(filePath)) {
        throw new Error(
            'No credentials found. To register your agent, visit:\n' +
            '  https://getterdone.ai/register-agent\n\n' +
            'Once registered, set the env var shown at the end of setup:\n' +
            '  GETTERDONE_API_KEY=gd_<clientId>:<clientSecret>\n\n' +
            'Or run the CLI setup command (MCP path only):\n' +
            '  npx @getterdone/mcp-server setup --name <agent-name>'
        );
    }

    try {
        const raw = readFileSync(filePath, 'utf-8');
        const creds = JSON.parse(raw) as Credentials;

        if (!creds.clientId || !creds.clientSecret) {
            throw new Error('Credentials file is missing clientId or clientSecret');
        }

        // Allow env override of API URL and funding token even when reading from file
        if (process.env.GETTERDONE_API_URL) {
            creds.apiUrl = process.env.GETTERDONE_API_URL;
        }
        if (process.env.GETTERDONE_FUNDING_TOKEN) {
            creds.fundingToken = process.env.GETTERDONE_FUNDING_TOKEN;
        }

        return creds;
    } catch (err) {
        if (err instanceof SyntaxError) {
            throw new Error(`Invalid credentials file at ${filePath}: ${err.message}`);
        }
        throw err;
    }
}

// ── Save ─────────────────────────────────────────────────

/**
 * Persist credentials to disk with restrictive permissions (0600).
 */
export function saveCredentials(creds: Credentials, path?: string): string {
    const filePath = path ?? defaultCredentialsPath();
    const dir = dirname(filePath);

    // Create directory if needed
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    writeFileSync(filePath, JSON.stringify(creds, null, 2) + '\n', 'utf-8');
    chmodSync(filePath, 0o600);

    return filePath;
}

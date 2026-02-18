/**
 * Credential persistence — load / save agent credentials to disk.
 *
 * Default path: ~/.getterdone/credentials.json
 * Env-var overrides: GETTERDONE_CLIENT_ID, GETTERDONE_CLIENT_SECRET
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
    // 1. Try env vars
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
        };
    }

    // 2. Try credentials file
    const filePath = path ?? defaultCredentialsPath();
    if (!existsSync(filePath)) {
        throw new Error(
            `No credentials found. Run "getterdone-mcp setup --name <agent>" first, ` +
            `or set GETTERDONE_CLIENT_ID and GETTERDONE_CLIENT_SECRET env vars.`
        );
    }

    try {
        const raw = readFileSync(filePath, 'utf-8');
        const creds = JSON.parse(raw) as Credentials;

        if (!creds.clientId || !creds.clientSecret) {
            throw new Error('Credentials file is missing clientId or clientSecret');
        }

        // Allow env override of API URL even when reading from file
        if (process.env.GETTERDONE_API_URL) {
            creds.apiUrl = process.env.GETTERDONE_API_URL;
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

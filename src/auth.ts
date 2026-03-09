/**
 * Authentication lifecycle:
 *   - SHA-256 Proof-of-Work solver
 *   - TokenManager with auto-refresh
 *   - Full setupAgent() registration flow
 */

import { createHash } from 'node:crypto';
import { ApiClient } from './api-client.js';
import { saveCredentials, type Credentials } from './credentials.js';

// ── PoW Solver ───────────────────────────────────────────

/**
 * Check if a buffer has at least `bits` leading zero bits.
 */
function hasLeadingZeroBits(buf: Buffer, bits: number): boolean {
    const fullBytes = Math.floor(bits / 8);
    const remainingBits = bits % 8;

    for (let i = 0; i < fullBytes; i++) {
        if (buf[i] !== 0) return false;
    }
    if (remainingBits > 0) {
        const mask = 0xff << (8 - remainingBits);
        if ((buf[fullBytes] & mask) !== 0) return false;
    }
    return true;
}

/**
 * Solve a SHA-256 proof-of-work challenge.
 *
 * Finds a hex string `candidate` such that
 * SHA-256(nonce + candidate) has ≥ difficulty leading zero bits.
 */
export function solveChallenge(
    nonce: string,
    difficulty: number
): { solution: string; iterations: number; durationMs: number } {
    const start = Date.now();

    for (let i = 0; ; i++) {
        const candidate = i.toString(16);
        const hash = createHash('sha256').update(nonce + candidate).digest();

        if (hasLeadingZeroBits(hash, difficulty)) {
            return {
                solution: candidate,
                iterations: i + 1,
                durationMs: Date.now() - start,
            };
        }
    }
}

// ── Token Manager ────────────────────────────────────────

export class TokenManager {
    private clientId: string;
    private clientSecret: string;
    private apiClient: ApiClient;
    private currentToken: string | null = null;
    private expiresAt = 0; // unix ms
    private refreshBuffer = 10 * 60 * 1000; // refresh 10 min before expiry

    constructor(clientId: string, clientSecret: string, apiClient: ApiClient) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.apiClient = apiClient;
    }

    /**
     * Get a valid access token, refreshing if needed.
     */
    async getToken(): Promise<string> {
        if (this.currentToken && Date.now() < this.expiresAt - this.refreshBuffer) {
            return this.currentToken;
        }

        const result = await this.apiClient.getTokenRaw({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: 'client_credentials',
        });

        this.currentToken = result.access_token;
        this.expiresAt = Date.now() + result.expires_in * 1000;

        return this.currentToken;
    }
}

// ── Setup Flow ───────────────────────────────────────────

export interface SetupResult {
    credentials: Credentials;
    savedTo: string;
}

/**
 * Full agent registration flow:
 *   1. Get challenge from API
 *   2. Solve SHA-256 PoW
 *   3. Register agent
 *   4. Persist credentials to disk
 */
export async function setupAgent(
    name: string,
    apiUrl: string,
    credentialsPath?: string,
    log: (msg: string) => void = console.error,
): Promise<SetupResult> {
    // Create an unauthenticated API client for registration
    const api = new ApiClient(apiUrl, async () => '');

    // 1. Get challenge
    log('🔑 Getting challenge...');
    const challenge = await api.getChallenge();
    log(`   Challenge ID: ${challenge.challengeId}`);
    log(`   Difficulty: ${challenge.difficulty} bits (~${2 ** challenge.difficulty} iterations)`);

    // 2. Solve PoW
    log('⚙️  Solving proof-of-work...');
    const { solution, iterations, durationMs } = solveChallenge(challenge.nonce, challenge.difficulty);
    log(`   ✅ Solved in ${iterations.toLocaleString()} iterations (${durationMs}ms)`);

    // 3. Register
    log('📝 Registering agent...');
    let result: { agent: { id: string; name: string }; clientId: string; clientSecret: string };
    try {
        result = await api.register({
            name,
            challengeId: challenge.challengeId,
            solution,
            timing: durationMs,
            environment: `node:${process.versions.node.split('.')[0]}`,
        });
    } catch (err: unknown) {
        const apiErr = err as { status?: number; message?: string };
        if (apiErr.status === 409) {
            throw new Error(
                `Agent name "${name}" is already taken. Choose a unique name and run setup again.\n` +
                `  Check availability: GET ${apiUrl.replace(/\/$/, '')}/api/auth/agent/check-name?q=${encodeURIComponent(name)}`
            );
        }
        throw err;
    }

    log(`   ✅ Agent "${result.agent.name}" registered!`);
    log(`   Agent ID: ${result.agent.id}`);
    log(`   Client ID: ${result.clientId}`);

    // 4. Save credentials
    const credentials: Credentials = {
        clientId: result.clientId,
        clientSecret: result.clientSecret,
        agentId: result.agent.id,
        agentName: result.agent.name,
        apiUrl,
        registeredAt: new Date().toISOString(),
    };

    const savedTo = saveCredentials(credentials, credentialsPath);
    log(`   💾 Credentials saved to ${savedTo}`);
    log('');
    log('⚠️  The clientSecret is shown only once. It has been saved to the file above.');
    log('   Keep this file safe and do not commit it to version control.');

    return { credentials, savedTo };
}

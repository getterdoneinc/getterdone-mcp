/**
 * HTTP client wrapping the GetterDone REST API.
 *
 * Features:
 *   - Automatic Bearer token injection
 *   - Retry on 429 (rate limit) and 500 (server error)
 *   - Structured error translation
 */

// ── Types ────────────────────────────────────────────────

export interface ApiError {
    status: number;
    code: string;
    message: string;
}

export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
}

interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
}

// ── Error Codes ──────────────────────────────────────────

const STATUS_TO_CODE: Record<number, string> = {
    400: 'bad_request',
    401: 'unauthorized',
    402: 'insufficient_balance',
    403: 'forbidden',
    404: 'not_found',
    409: 'conflict',
    410: 'window_closed',
    429: 'rate_limited',
    500: 'server_error',
};

// ── Client ───────────────────────────────────────────────

export class ApiClient {
    private baseUrl: string;
    private getToken: () => Promise<string>;
    private retry: RetryConfig;

    constructor(
        baseUrl: string,
        getToken: () => Promise<string>,
        retry: RetryConfig = { maxRetries: 2, baseDelayMs: 1000 }
    ) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.getToken = getToken;
        this.retry = retry;
    }

    // ── Generic request ──────────────────────────────────

    private async request<T>(
        method: string,
        path: string,
        body?: unknown,
        requireAuth = true,
    ): Promise<T> {
        let lastError: ApiError | null = null;

        for (let attempt = 0; attempt <= this.retry.maxRetries; attempt++) {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'User-Agent': '@getterdone/mcp-server',
            };

            if (requireAuth) {
                headers['Authorization'] = `Bearer ${await this.getToken()}`;
            }

            const res = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
            });

            // Success
            if (res.ok) {
                const json = await res.json() as ApiResponse<T>;
                return json.data as T;
            }

            // Parse error
            let errorMessage: string;
            try {
                const errorJson = await res.json() as ApiResponse;
                errorMessage = errorJson.error ?? `HTTP ${res.status}`;
            } catch {
                errorMessage = `HTTP ${res.status} ${res.statusText}`;
            }

            lastError = {
                status: res.status,
                code: STATUS_TO_CODE[res.status] ?? 'unknown',
                message: errorMessage,
            };

            // Retry on 429 or 500
            if ((res.status === 429 || res.status === 500) && attempt < this.retry.maxRetries) {
                const retryAfter = res.headers.get('Retry-After');
                const delayMs = retryAfter
                    ? parseInt(retryAfter, 10) * 1000
                    : this.retry.baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
                await sleep(delayMs);
                continue;
            }

            // Non-retryable error
            break;
        }

        throw lastError!;
    }

    // ── Auth (no Bearer required) ────────────────────────

    async getChallenge(): Promise<{
        challengeId: string;
        nonce: string;
        difficulty: number;
        expiresAt: number;
    }> {
        return this.request('GET', '/api/auth/agent/challenge', undefined, false);
    }

    async register(body: {
        name: string;
        challengeId: string;
        solution: string;
        timing: number;
        environment: string;
    }): Promise<{
        agent: { id: string; name: string };
        clientId: string;
        clientSecret: string;
    }> {
        return this.request('POST', '/api/auth/agent/register', body, false);
    }

    async getTokenRaw(body: {
        client_id: string;
        client_secret: string;
        grant_type: 'client_credentials';
    }): Promise<{
        access_token: string;
        token_type: string;
        expires_in: number;
    }> {
        // Token endpoint returns a different shape (OAuth2), handle directly
        const res = await fetch(`${this.baseUrl}/api/auth/agent/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': '@getterdone/mcp-server',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            let msg: string;
            try {
                const err = await res.json() as { error_description?: string; error?: string };
                msg = err.error_description ?? err.error ?? `HTTP ${res.status}`;
            } catch {
                msg = `HTTP ${res.status}`;
            }
            throw { status: res.status, code: 'unauthorized', message: msg } satisfies ApiError;
        }

        return res.json() as Promise<{
            access_token: string;
            token_type: string;
            expires_in: number;
        }>;
    }

    // ── Tasks ────────────────────────────────────────────

    async createTask(body: {
        title: string;
        description: string;
        reward: number;
        category?: string;
        location: { lat: number; lng: number; label: string; remote?: boolean };
        expiresInHours?: number;
        reviewCriteria?: { keywords?: string[]; minImages?: number };
    }): Promise<unknown> {
        return this.request('POST', '/api/tasks', body);
    }

    async listTasks(params: { status?: string; limit?: number } = {}): Promise<unknown> {
        const qs = new URLSearchParams();
        if (params.status && params.status !== 'all') qs.set('status', params.status);
        if (params.limit) qs.set('limit', String(params.limit));
        const query = qs.toString();
        return this.request('GET', `/api/tasks${query ? '?' + query : ''}`);
    }

    async getTask(taskId: string): Promise<unknown> {
        return this.request('GET', `/api/tasks/${taskId}`);
    }

    async approveTask(taskId: string): Promise<unknown> {
        return this.request('POST', `/api/tasks/${taskId}/complete`);
    }

    async disputeTask(taskId: string, reason: string): Promise<unknown> {
        return this.request('POST', `/api/tasks/${taskId}/dispute`, { reason });
    }

    async cancelTask(taskId: string): Promise<unknown> {
        return this.request('POST', `/api/tasks/${taskId}/cancel`);
    }

    // ── Account ──────────────────────────────────────────

    async fundAccount(amount: number, paymentMethodNonce?: string): Promise<unknown> {
        return this.request('POST', '/api/agents/fund', { amount, paymentMethodNonce });
    }

    async getBalance(): Promise<unknown> {
        return this.request('GET', '/api/agents/balance');
    }

    // ── Ratings & Reputation ─────────────────────────────

    async rateWorker(taskId: string, score: number, comment?: string): Promise<unknown> {
        return this.request('POST', `/api/tasks/${taskId}/rate`, { score, comment });
    }

    async getReputation(agentId?: string): Promise<unknown> {
        if (!agentId) {
            // Fallback: the server should infer from token, but we need the ID
            // Return an error hint — caller should supply the ID from credentials
            throw {
                status: 400,
                code: 'bad_request',
                message: 'agentId is required for reputation lookup',
            } satisfies ApiError;
        }
        return this.request('GET', `/api/agents/${agentId}/reputation`, undefined, false);
    }

    // ── Webhooks ─────────────────────────────────────────

    async configureWebhook(url: string): Promise<unknown> {
        return this.request('POST', '/api/agents/webhooks', { url });
    }

    async getWebhookConfig(): Promise<unknown> {
        return this.request('GET', '/api/agents/webhooks');
    }
}

// ── Helpers ──────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

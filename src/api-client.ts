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
    /** Machine-readable error code, e.g. NO_FUNDING_TOKEN, OPEN_TASK_LIMIT, TASK_CREATION_LIMIT. */
    code?: string;
}

/**
 * 429 codes that represent DURABLE business caps, not a transient request rate
 * limit — retrying won't clear them, so they must surface immediately. The
 * generic request rate limiter returns a 429 with no such code and IS retried.
 */
const NON_RETRYABLE_429_CODES = new Set(['OPEN_TASK_LIMIT', 'TASK_CREATION_LIMIT']);

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

            // Parse error — prefer the body's machine-readable `code` over the
            // status-derived fallback so specific codes (OPEN_TASK_LIMIT, …) survive.
            let errorMessage: string;
            let errorCode: string | undefined;
            try {
                const errorJson = await res.json() as ApiResponse;
                errorMessage = errorJson.error ?? `HTTP ${res.status}`;
                errorCode = errorJson.code;
            } catch {
                errorMessage = `HTTP ${res.status} ${res.statusText}`;
            }

            lastError = {
                status: res.status,
                code: errorCode ?? STATUS_TO_CODE[res.status] ?? 'unknown',
                message: errorMessage,
            };

            // Retry on 500, and on 429 ONLY when it's a transient request-rate limit —
            // NOT a durable task-count cap (OPEN_TASK_LIMIT / TASK_CREATION_LIMIT), which
            // retrying can't clear and which the agent should see immediately to back off.
            const retryable429 = res.status === 429 && !(errorCode && NON_RETRYABLE_429_CODES.has(errorCode));
            if ((retryable429 || res.status === 500) && attempt < this.retry.maxRetries) {
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
        tags?: string[];
        reviewCriteria?: { keywords?: string[]; minImages?: number; minVideos?: number };
        minTrustScore?: number;
    }): Promise<unknown> {
        const { expiresInHours, ...rest } = body;
        const deadline = expiresInHours != null
            ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
            : undefined;
        return this.request('POST', '/api/tasks', { ...rest, deadline });
    }

    async listTasks(params: { status?: string; agentId?: string; q?: string; limit?: number } = {}): Promise<unknown> {
        const qs = new URLSearchParams();
        if (params.status && params.status !== 'all') qs.set('status', params.status);
        if (params.agentId) qs.set('agentId', params.agentId);
        if (params.q) qs.set('q', params.q);
        if (params.limit) qs.set('limit', String(params.limit));
        const query = qs.toString();
        return this.request('GET', `/api/tasks${query ? '?' + query : ''}`);
    }

    /**
     * Fetch submitted tasks awaiting this agent's review decision.
     * Scoped to the calling agent via agentId — never returns other agents' tasks.
     */
    async getPendingReviews(agentId: string): Promise<unknown> {
        const qs = new URLSearchParams({ status: 'submitted', limit: '50', agentId });
        return this.request('GET', `/api/tasks?${qs.toString()}`);
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

    async fundAccount(amount: number, fundingToken?: string): Promise<unknown> {
        return this.request('POST', '/api/agents/fund', { amount, fundingToken });
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

    // ── Platform Feedback ────────────────────────────────────

    async reportPlatformIssue(body: {
        type: 'bug' | 'feature_request' | 'general';
        title: string;
        description: string;
        severity?: 'low' | 'medium' | 'high' | 'critical';
    }): Promise<unknown> {
        return this.request('POST', '/api/platform/feedback', body);
    }

    // ── Worker & Agent Profiles ──────────────────────────────

    /**
     * Get a worker's public profile (auth required — sends agent Bearer token).
     * Returns: nickname, avatarSeed, rating, trustTier, completedTasks, recentRatings.
     */
    async getWorkerProfile(workerId: string): Promise<unknown> {
        return this.request('GET', `/api/workers/${workerId}/profile`);
    }

    /**
     * Upload a reference file to a task as an attachment.
     *
     * Accepts two source types:
     *   - { type: 'url', url }      — downloads from a public URL and re-uploads.
     *   - { type: 'base64', data, mimeType } — decodes base64 locally; no outbound fetch.
     *
     * Only the posting agent can upload. Task must be open or claimed.
     */
    async uploadAttachment(
        taskId: string,
        filename: string,
        source: { type: 'url'; url: string } | { type: 'base64'; data: string; mimeType: string },
    ): Promise<unknown> {
        let blob: Blob;

        if (source.type === 'url') {
            // Fetch the file from the provided public URL
            let fileRes: Response;
            try {
                fileRes = await fetch(source.url);
            } catch (err) {
                throw {
                    status: 400,
                    code: 'bad_request',
                    message: `Failed to fetch file from URL: ${err instanceof Error ? err.message : String(err)}`,
                } satisfies ApiError;
            }
            if (!fileRes.ok) {
                throw {
                    status: 400,
                    code: 'bad_request',
                    message: `Could not download file (HTTP ${fileRes.status}). Make sure the URL is publicly accessible.`,
                } satisfies ApiError;
            }
            const contentType = fileRes.headers.get('content-type') ?? 'application/octet-stream';
            const buffer = await fileRes.arrayBuffer();
            blob = new Blob([buffer], { type: contentType });
        } else {
            // Decode base64 locally — no external request needed
            const buffer = Buffer.from(source.data, 'base64');
            blob = new Blob([buffer], { type: source.mimeType });
        }

        const formData = new FormData();
        formData.append('file', blob, filename);

        const token = await this.getToken();
        const res = await fetch(`${this.baseUrl}/api/tasks/${taskId}/attachments`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': '@getterdone/mcp-server',
                // Do NOT set Content-Type — let fetch set multipart boundary automatically
            },
            body: formData,
        });

        if (!res.ok) {
            let errorMessage: string;
            try {
                const errorJson = await res.json() as { error?: string };
                errorMessage = errorJson.error ?? `HTTP ${res.status}`;
            } catch {
                errorMessage = `HTTP ${res.status} ${res.statusText}`;
            }
            throw {
                status: res.status,
                code: STATUS_TO_CODE[res.status] ?? 'unknown',
                message: errorMessage,
            } satisfies ApiError;
        }

        const json = await res.json() as { success: boolean; data?: unknown };
        return json.data;
    }

    /**
     * Get comprehensive metrics for the authenticated agent's own account.
     * Includes: balance, task breakdown, total spend, reputation, recent worker ratings.
     */
    async getAgentMetrics(agentId: string): Promise<unknown> {
        return this.request('GET', `/api/agents/${agentId}/metrics`);
    }
}

// ── Helpers ──────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

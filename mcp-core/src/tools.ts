/**
 * Register all 20 MCP tools on the server instance.
 *
 * Shared by the hosted `/mcp` endpoint and the stdio package (CONNECT-01 §2).
 * Every tool carries MCP annotations (readOnlyHint / destructiveHint /
 * idempotentHint / openWorldHint) — consumer agents (dots, Muse, Claude) use
 * them to decide which calls need a human confirmation prompt — and the
 * write tools are gated on the token's OAuth scope (`tasks:write` or
 * `agent:full`); `client_credentials` tokens carry no scope and keep full
 * access.
 */

import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { ApiClient, ApiError } from './api-client';
import { scopeGrantsWrite } from './scope';

// ── Types ────────────────────────────────────────────────

type ToolResult = {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
};

export interface ToolOptions {
    /**
     * Space-separated OAuth scope of the caller's token. `undefined` means a
     * `client_credentials` token (full access). Tokens without a write scope
     * get a structured `insufficient_scope` error from every write tool.
     */
    scope?: string;
    /**
     * Consumer-agent connection mode (the OAuth client is self-registered,
     * URL-identified or admin-marked — any connector-shaped client):
     * `create_task` REQUIRES a `confirmationToken` from `quote_task`, so the
     * host can show the exact charge before the sensitive write
     * (CONNECT-01 §5 — UX only, not a security control).
     */
    connector?: boolean;
}

/** Per-tool annotations — the catalog of record for read/write classes. */
export const TOOL_SCOPES: Record<string, ToolAnnotations> = {
    quote_task:            { title: 'Quote a task',            readOnlyHint: true,  idempotentHint: true },
    create_task:           { title: 'Create a task',           readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    list_tasks:            { title: 'List tasks',              readOnlyHint: true,  idempotentHint: true },
    get_pending_reviews:   { title: 'Pending reviews',         readOnlyHint: true,  idempotentHint: true },
    get_task:              { title: 'Get a task',              readOnlyHint: true,  idempotentHint: true },
    approve_task:          { title: 'Approve a task',          readOnlyHint: false, destructiveHint: true,  idempotentHint: true },
    dispute_task:          { title: 'Dispute a task',          readOnlyHint: false, destructiveHint: true,  idempotentHint: true },
    cancel_task:           { title: 'Cancel a task',           readOnlyHint: false, destructiveHint: true,  idempotentHint: true },
    fund_account:          { title: 'Fund account (deprecated)', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    get_balance:           { title: 'Balance',                 readOnlyHint: true,  idempotentHint: true },
    get_funding_status:    { title: 'Funding status',          readOnlyHint: true,  idempotentHint: true },
    rate_worker:           { title: 'Rate a worker',           readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    get_reputation:        { title: 'Reputation',              readOnlyHint: true,  idempotentHint: true },
    configure_webhook:     { title: 'Configure webhook',       readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    events_poll:           { title: 'Poll events',             readOnlyHint: true,  idempotentHint: true },
    events_ack:            { title: 'Acknowledge events',      readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    report_platform_issue: { title: 'Report an issue',         readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    get_worker_profile:    { title: 'Worker profile',          readOnlyHint: true,  idempotentHint: true },
    get_agent_metrics:     { title: 'Agent metrics',           readOnlyHint: true,  idempotentHint: true },
    upload_attachment:     { title: 'Upload attachment',       readOnlyHint: false, destructiveHint: false, idempotentHint: false },
};

// ── Helpers ──────────────────────────────────────────────

function success(data: unknown): ToolResult {
    return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
}

function error(err: unknown): ToolResult {
    const apiErr = err as ApiError;
    let message = apiErr?.message
        ? `[${apiErr.code ?? 'error'}] ${apiErr.message}`
        : String(err);
    // CONNECT-01 §4: the 402 carries a human next step plus the deep link the
    // host can show the person (ISSUE-032 — it used to be dropped here).
    if (apiErr?.onboardingUrl) {
        message += ` Next step — the account owner opens: ${apiErr.onboardingUrl}`;
    }
    return {
        content: [{ type: 'text', text: message }],
        isError: true,
    };
}

async function wrap(fn: () => Promise<unknown>): Promise<ToolResult> {
    try {
        const data = await fn();
        return success(data);
    } catch (err) {
        return error(err);
    }
}

// ── Ids ──────────────────────────────────────────────────

/** Task / agent / worker ids are UUIDs or `gd_…` handles — never path-shaped. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const idSchema = (what: string) => z.string().regex(ID_PATTERN, `${what} must be 1–64 characters of letters, digits, _ or -`);

// ── create_task / quote_task shared schema ───────────────

const createTaskShape = {
            title: z.string().min(5).max(150).describe("Short title (e.g., 'Buy coffee at Starbucks on 5th Ave')"),
            description: z.string().min(20).max(5000).describe('Detailed instructions for the worker'),
            privateDescription: z.string().max(5000).optional().describe('Optional additional instructions visible ONLY to the posting agent and to payout-onboarded (KYC-verified) workers — use for details that should not be publicly browsable (entry instructions, contact names, unit numbers). Never put credentials or payment info here.'),
            reward: z.number().min(1).max(100).describe('USD amount to pay the worker ($1–$100)'),
            category: z.enum(['General', 'Research', 'Data Entry', 'Writing', 'Design', 'Photography', 'Delivery', 'Handyman', 'Errands', 'Translation', 'Customer Service', 'Verification', 'Inspection', 'Mystery Shopping', 'Promotion', 'Proofreading', 'Video', 'Voice & Audio', 'Social Media', 'Other']).default('General').describe('Task category'),
            lat: z.number().optional().describe('Location latitude (optional when remote=true)'),
            lng: z.number().optional().describe('Location longitude (optional when remote=true)'),
            locationLabel: z.string().max(200).optional().describe('Human-readable address (optional when remote=true)'),
            remote: z.boolean().default(false).describe('Set true for any task that does not require the worker to be at a physical location — including image-only tasks, research tasks, writing, or any remotely-fulfilled work. If omitted or false, you MUST supply lat, lng, and locationLabel.'),
            expiresInHours: z.number().min(0.5).max(720).default(24).describe('Hours until auto-expiry if unclaimed (0.5–720, i.e. 30 min minimum). Values >144 (6 days) require Established/Business owner-account standing.'),
            keywords: z.array(z.string().max(50)).max(20).optional().describe('Keywords required in worker proof (max 20, each max 50 chars inclusive — a 50-character keyword is valid)'),
            minImages: z.number().int().min(0).max(10).optional().describe('Minimum images required in worker proof (0–10). Pass 0 to explicitly record no image requirement. Omit entirely to leave reviewCriteria unset.'),
            minVideos: z.number().int().min(0).max(3).optional().describe('Minimum video clips required in worker proof (0–3). Workers may upload up to 3 clips (MP4/WebM/MOV, max 512 MB each). Omit if no video requirement.'),
            minTrustScore: z.number().int().min(0).max(100).optional().describe('Minimum worker trust score to claim this task (0–100, default: open to all)'),
            tags: z.array(z.string().max(50)).max(10).optional().describe('Optional labels for searchability (max 10 tags, each max 50 chars, no HTML). Agents and workers can search by tag via the q= filter on list_tasks.'),
};

/** Output type of a raw shape — works on zod 3 and 4 (no objectOutputType dependency). */
type InferShape<Shape extends z.ZodRawShape> = { [K in keyof Shape]: z.infer<Shape[K]> };

type CreateTaskArgs = InferShape<typeof createTaskShape>;

/** Flat MCP args → REST body (same mapping for quote_task and create_task). */
function buildCreateTaskBody(args: CreateTaskArgs) {
    return {
        title: args.title,
        description: args.description,
        ...(args.privateDescription ? { privateDescription: args.privateDescription } : {}),
        reward: args.reward,
        category: args.category,
        location: {
            lat: args.remote && args.lat == null ? 0 : (args.lat ?? 0),
            lng: args.remote && args.lng == null ? 0 : (args.lng ?? 0),
            label: args.remote && args.locationLabel == null ? 'Remote' : (args.locationLabel ?? ''),
            remote: args.remote,
        },
        expiresInHours: args.expiresInHours,
        reviewCriteria: (
            (args.keywords != null && args.keywords.length > 0) ||
            typeof args.minImages === 'number' ||
            typeof args.minVideos === 'number'
        )
            ? { keywords: args.keywords, minImages: args.minImages, minVideos: args.minVideos }
            : undefined,
        minTrustScore: args.minTrustScore,
        tags: args.tags,
    };
}

// ── Registration ─────────────────────────────────────────

export function registerTools(server: McpServer, api: ApiClient, agentId: string, opts: ToolOptions = {}): void {
    const canWrite = scopeGrantsWrite(opts.scope);

    /**
     * registerTool with the catalog annotations and the scope gate: a write
     * tool called with a read-only token returns a structured error instead
     * of reaching the API (which would refuse it anyway — defense in depth).
     */
    function tool<Shape extends z.ZodRawShape>(
        name: keyof typeof TOOL_SCOPES,
        description: string,
        inputSchema: Shape,
        cb: (args: InferShape<Shape>) => Promise<ToolResult>
    ): void {
        const annotations = TOOL_SCOPES[name];
        server.registerTool(
            name,
            { description, inputSchema, annotations },
            (async (args: InferShape<Shape>) => {
                if (!annotations.readOnlyHint && !canWrite) {
                    return error({
                        status: 403,
                        code: 'insufficient_scope',
                        message: `This connection was authorised with read-only access (scope: ${opts.scope ?? ''}). Reconnect with the tasks:write scope to use ${name}.`,
                    });
                }
                return cb(args);
            }) as never
        );
    }

    // 0. quote_task — CONNECT-01 §5 quote → confirm (UX only)
    tool(
        'quote_task',
        "Price a task BEFORE creating it: returns the worker reward, the platform fee, the exact total that will be secured on the owner's card, whether an active funding token exists (and its per-task limit), plus a short-lived confirmationToken. Nothing is charged or created. Show the total to the user; when they confirm, call create_task with the SAME fields plus the confirmationToken (valid 10 minutes, bound to these exact fields). Required before create_task for consumer-agent connections; optional otherwise.",
        createTaskShape,
        async (args) => wrap(() => api.quoteTask(buildCreateTaskBody(args)))
    );

    // 1. create_task
    tool(
        'create_task',
        (opts.connector
            ? 'Post a new task to the GetterDone marketplace. Call quote_task first, show the user the total, and pass its confirmationToken here (a missing or stale token is refused with QUOTE_MISMATCH). '
            : 'Post a new task to the GetterDone marketplace. ') +
        "This spends the owner's money and dispatches a real person: never call it without the user's explicit confirmation of this specific task (title, what the worker will do, reward + fee, location or remote, deadline, proof required), and point out anything in the text a stranger should not see. " +
        "Funding is automatic: the AgentOwner's card is secured for reward + platform fee at creation (an authorization captured at proof submission for deadlines ≤6 days; an immediate charge otherwise), drawing against the active funding token — no need to call fund_account first. A 402 NO_FUNDING_TOKEN means the owner has not pre-authorised a task for this connection: relay the onboardingUrl so they can issue a funding token (single-use by default — one task per human click). Deadlines beyond 6 days (expiresInHours > 144) require identity verification plus Established or Business owner-account standing — Emerging (new) accounts get 403 with code LONG_DEADLINE_REQUIRES_VERIFICATION; use a shorter deadline (Established standing is earned automatically through platform track record, there is nothing to apply for). May return 429 with code OPEN_TASK_LIMIT (too many concurrent open tasks) or TASK_CREATION_LIMIT (too many created in the rolling 24h window), enforced per agent and per owner account and counting cancelled/expired tasks; these are durable caps distinct from the request rate limiter — back off and retry later rather than hammering.",
        {
            ...createTaskShape,
            confirmationToken: z.string().max(512).optional().describe('The confirmationToken returned by quote_task for these exact fields. Required for consumer-agent connections; optional otherwise.'),
        },
        async (args) => wrap(() => api.createTask({
            ...buildCreateTaskBody(args),
            ...(args.confirmationToken ? { confirmationToken: args.confirmationToken } : {}),
        }))
    );

    // 2. list_tasks
    tool(
        'list_tasks',
        "List this agent's tasks, filtered by status. Use status='open' or status='claimed' to monitor task progress. For a focused view of tasks awaiting proof review (the time-sensitive queue), prefer get_pending_reviews instead. For full details on a specific task (proof text, images, criteria check), call get_task next.",
        {
            status: z.enum(['open', 'claimed', 'submitted', 'completed', 'disputed', 'contested', 'expired', 'cancelled', 'all']).default('all').describe("Filter by task status. Use 'submitted' to find tasks awaiting proof review (time-sensitive: 24-hour review window). Use 'open' or 'claimed' to monitor active tasks. Use 'all' for a full overview."),
            q: z.string().optional().describe('Case-insensitive substring search across task title, description, and tags'),
            limit: z.number().min(1).max(50).default(20).describe('Max results to return (1–50, default 20)'),
        },
        async (args) => wrap(() => api.listTasks({ status: args.status, agentId, q: args.q, limit: args.limit }))
    );

    // 3. get_pending_reviews
    tool(
        'get_pending_reviews',
        [
            "Fetch all submitted tasks currently awaiting your approval decision — the complete pending-review queue in one call.",
            "",
            "Each task in the response includes:",
            "  • proofOfWork       — worker's submitted text, image URLs, and video URLs",
            "  • criteriaCheckResult — automated syntactic check (passed, score 0–100, per-check details)",
            "  • imageAuthenticityResult — reverse-image-search result (clean / likely_stock / suspicious / skipped)",
            "",
            "Proof media URLs are STABLE authenticated links (never expire, no signature): download with",
            "your API key as the Bearer header and follow the 302 redirect, e.g.",
            "curl -L -H 'Authorization: Bearer <key>' <url>. Copy them verbatim — never reconstruct",
            "storage.googleapis.com URLs from path fragments (they fail with AccessDenied). Safe to",
            "relay to your human: a browser click hands off to the GetterDone web login (worker or",
            "agent-owner account) and then opens the media.",
            "",
            "⚠️  CRITICAL — 24-hour dispute window: once a task reaches 'submitted', you have exactly 24 hours",
            "from submittedAt to call approve_task or dispute_task. Dispute before the window closes, or",
            "payment releases to the worker regardless of proof quality. Always process this queue promptly.",
            "",
            "⚠️  The criteriaCheckResult is SYNTACTIC only — a keyword 'receipt' matches even if the worker",
            "wrote 'I could not find the receipt.' You must read the proof text yourself before deciding.",
            "",
            "Use this tool in your polling loop instead of list_tasks({ status: 'submitted' }) — it returns",
            "fully hydrated tasks so you do not need follow-up get_task calls for each item.",
            "",
            "If a task shows checksPending: true, its media checks (reverse-image-search, duplicate,",
            "AI-provenance, capture time/location) are still running — wait ~5 seconds and call",
            "get_task, or wait for the task.checks_completed event. Don't approve while",
            "checksPending is true.",
        ].join('\n'),
        {},
        async () => wrap(() => api.getPendingReviews(agentId))
    );

    // 4. get_task
    tool(
        'get_task',
        'Get full details for a specific task, including proof-of-work submissions and dispute history.',
        {
            taskId: idSchema('taskId').describe('The unique task ID'),
        },
        async (args) => wrap(() => api.getTask(args.taskId))
    );

    // 4. approve_task
    tool(
        'approve_task',
        "Approve a submitted task and release the secured funds to the worker. This is IRREVERSIBLE. Read proofOfWork.text and look at the images first — criteriaCheckResult is a syntactic keyword check, not a judgement — and get the user's explicit decision before calling. Must happen within 24 hours of submittedAt or the worker is paid automatically. A 402 means the payout transfer failed temporarily: the approval is saved, retry the same call. Call rate_worker right after.",
        {
            taskId: idSchema('taskId').describe('The task ID to approve'),
        },
        async (args) => wrap(() => api.approveTask(args.taskId))
    );

    // 5. dispute_task
    tool(
        'dispute_task',
        "Dispute a submitted task's proof-of-work (no payment). The worker is notified and has 48 hours to contest, after which an admin adjudicates; uncontested disputes resolve in your favour and the funds return to the owner. Get the user's explicit decision and a specific reason first. Every dispute permanently counts toward your dispute rate, so dispute deficient work, not borderline work. Must happen within 24 hours of submittedAt.",
        {
            taskId: idSchema('taskId').describe('The task ID to dispute'),
            reason: z.string().min(10).max(2000).describe('Detailed reason why the proof is insufficient (10–2000 chars)'),
        },
        async (args) => wrap(() => api.disputeTask(args.taskId, args.reason))
    );

    // 6. cancel_task
    tool(
        'cancel_task',
        'Cancel an open task. For normal (≤6-day-deadline) tasks the card hold is released — nothing was ever charged; long-deadline charged-at-posting tasks are refunded to the card. Cannot cancel claimed or submitted tasks.',
        {
            taskId: idSchema('taskId').describe('The task ID to cancel'),
        },
        async (args) => wrap(() => api.cancelTask(args.taskId))
    );

    // 7. fund_account
    tool(
        'fund_account',
        "DEPRECATED & NO-OP: funding is automatic at task creation (create_task charges the AgentOwner's card directly). This no longer charges the card or credits any balance — it returns success so old integrations don't error. Do not call it; just call create_task.",
        {
            amount: z.number().min(1).describe('USD amount to add (minimum $1.00). Must not exceed the token limit set by the AgentOwner.'),
            fundingToken: z.string().optional().describe(
                'Optional: explicit funding token override (format: gd_fund_XXXXXXXX). ' +
                'Omit this — the server auto-resolves the active token for this agent.'
            ),
        },
        async (args) => {
            // Pass explicit token only if provided; server auto-resolves otherwise
            return wrap(() => api.fundAccount(args.amount, args.fundingToken));
        }
    );

    // 8. get_balance
    tool(
        'get_balance',
        "Get the agent's wallet balance and pending secured funds. Under direct-charge funding, create_task charges the AgentOwner's card per task, so balance is informational (it reflects any legacy wallet credit) and pendingEscrow sums the funds secured across the agent's active tasks. Returns: { balance, pendingEscrow, currency }.",
        {},
        async () => wrap(() => api.getBalance())
    );

    // 8b. get_funding_status
    tool(
        'get_funding_status',
        "Pre-flight readiness check before creating paid tasks — use this (not get_balance) to verify setup. A successful call proves your credentials are valid; ready:true means the Agent Owner setup is complete (KYC + vaulted card + active funding token) and create_task will not fail with 402 NO_FUNDING_TOKEN. When ready is false, surface onboardingUrl to your developer — it deep-links the one-time Agent Owner setup pre-filled for this agent. When ready, recurring tells you whether you can keep posting without another human step (false = single-use token, consumed by your next task; true = stays active across tasks) and perTaskLimitUsd is the token's per-task ceiling (create_task fails if reward + fee exceeds it). platformCreditUsd is spendable platform credit — a task whose reward + fee fits inside it is funded by credit (no card charge; terminations return the funds as credit). Returns: { ready, hasActiveFundingToken, ownerKycStatus, onboardingUrl?, recurring?, perTaskLimitUsd?, platformCreditUsd? }.",
        {},
        async () => wrap(() => api.getFundingStatus())
    );

    // 9. rate_worker
    tool(
        'rate_worker',
        'Leave a 1–5 star rating for a worker after task completion. Must be within the 24-hour window.',
        {
            taskId: idSchema('taskId').describe('The completed task ID'),
            score: z.number().int().min(1).max(5).describe('Star rating (1 = poor, 5 = excellent)'),
            comment: z.string().optional().describe('Optional text feedback'),
        },
        async (args) => wrap(() => api.rateWorker(args.taskId, args.score, args.comment))
    );

    // 10. get_reputation
    tool(
        'get_reputation',
        "Quick reputation snapshot for any agent: reliability tier (excellent/good/caution/unreliable/new), dispute rate, worker rating average, and disputesLost (a durable count of disputes an admin decided against the agent — monotonic, not reset by resolving disputes). Use this to check your own standing or vet another agent. For your own full performance dashboard (balance, task counts by status, total spend), use get_agent_metrics instead.",
        {
            agentId: idSchema('agentId').optional().describe('Agent ID to look up. Omit to get your own reputation.'),
        },
        async (args) => wrap(() => api.getReputation(args.agentId ?? agentId))
    );

    // 11. configure_webhook
    tool(
        'configure_webhook',
        'Register or update a webhook URL to receive real-time task event notifications (task.claimed, task.submitted, task.completed, task.declined, task.expired, task.refunded, task.expiring_soon, etc. — expiry emits task.expired; task.refunded covers cancel/dispute-refund/closure). Payloads carry an eventId shared with the events_poll inbox for dual-channel dedupe. IMPORTANT: the response includes a webhookSecret — store it immediately and securely. It is shown ONLY ONCE and cannot be retrieved again. Use the secret to verify HMAC-SHA256 signatures on incoming webhook payloads.',
        {
            url: z.string().url().refine(
                (u) => u.startsWith('https://'),
                'Webhook URL must use HTTPS'
            ).describe('Your public HTTPS endpoint to receive POST webhook events. Must be reachable from the internet.'),
        },
        async (args) => wrap(() => api.configureWebhook(args.url))
    );

    // 11b. events_poll — Agent Event Inbox (RFC-001)
    tool(
        'events_poll',
        "Poll your durable event inbox — the no-webhook way to never miss a task event. Returns events (task.claimed, task.submitted, task.completed, task.disputed, task.contested, task.expiring_soon, …) in guaranteed per-agent order with a monotonic seq. Contract: call with no cursor to resume from your last ack (unacked events re-appear — deduplicate on the envelope id); process the batch; then call events_ack with the returned nextCursor. Events are THIN (type + task pointer + hints) — fetch fresh details with get_task. hasMore=true means poll again immediately. A 410 CURSOR_EXPIRED means your cursor predates the 30-day retention — resume from the oldestAvailableCursor it returns and treat the gap as missed events.",
        {
            cursor: z.number().int().min(0).optional().describe('Resume after this seq. Omit to resume from your last acked cursor.'),
            limit: z.number().int().min(1).max(100).optional().describe('Max events to scan (default 50).'),
            types: z.array(z.string()).optional().describe("Only return these event types (e.g. ['task.submitted']). Filtered events still advance nextCursor."),
        },
        async (args) => wrap(() => api.pollEvents(args.cursor, args.limit, args.types))
    );

    // 11c. events_ack
    tool(
        'events_ack',
        'Acknowledge inbox events up to a cursor (high-water mark): everything with seq ≤ cursor is marked consumed, so your next cursor-less events_poll resumes after it. Call this with the nextCursor from events_poll AFTER you have processed that batch — acking before processing risks losing events if you crash. Acking a lower cursor than before is a harmless no-op.',
        {
            cursor: z.number().int().min(0).describe('The nextCursor value from the events_poll batch you just finished processing.'),
        },
        async (args) => wrap(() => api.ackEvents(args.cursor))
    );

    // 12. report_platform_issue
    tool(
        'report_platform_issue',
        'Submit a bug report, feature request, or general observation to the GetterDone platform admins. Use this when you encounter an API inconsistency, unexpected behaviour, or have a suggestion.',
        {
            type: z.enum(['bug', 'feature_request', 'general']).describe("Type of feedback: 'bug' for errors/inconsistencies, 'feature_request' for suggestions, 'general' for other observations"),
            title: z.string().min(3).max(120).describe('Short summary of the issue or request (max 120 chars)'),
            description: z.string().min(10)
                // Custom check instead of .max() so the error ECHOES the received
                // length — the bare limit message forced blind trimming over four
                // round-trips for a 2,212-char report (DevX cell-2, 2026-08-15).
                // superRefine form works on zod 3 and 4 (refine's function-message overload does not).
                .superRefine((s, ctx) => {
                    if (s.length > 2000) ctx.addIssue({ code: 'custom', message: `description is ${s.length} characters; the maximum is 2000 — trim by at least ${s.length - 2000}` });
                })
                .describe('Detailed description including steps to reproduce, expected vs actual behaviour, or the rationale for the feature request (max 2000 chars)'),
            severity: z.enum(['low', 'medium', 'high', 'critical']).optional().describe("Estimated severity (optional): 'critical' = platform unusable, 'high' = major feature broken, 'medium' = degraded experience, 'low' = minor annoyance"),
        },
        async (args) => wrap(() => api.reportPlatformIssue({
            type: args.type,
            title: args.title,
            description: args.description,
            severity: args.severity,
        }))
    );

    // 13. get_worker_profile
    tool(
        'get_worker_profile',
        "Get a worker's public profile including their trust tier, star rating, task completion stats, and recent ratings from agents. Use this to vet a worker before assigning high-value tasks.",
        {
            workerId: idSchema('workerId').describe("The worker's unique user ID (found in task.workerId)"),
        },
        async (args) => wrap(() => api.getWorkerProfile(args.workerId))
    );

    // 14. get_agent_metrics
    tool(
        'get_agent_metrics',
        "Full performance dashboard for your own agent account: current balance, task count broken down by status (open/claimed/submitted/completed/disputed/expired), total platform spend, reputation stats, and recent worker ratings. Use this for operational reporting or when a user asks for an account summary. For a quick reliability-tier check on any agent (including other agents), use get_reputation instead.",
        {},
        async () => wrap(() => api.getAgentMetrics(agentId))
    );

    // 15. upload_attachment
    tool(
        'upload_attachment',
        'Upload a reference file (image, PDF, or short video) to a task so the assigned worker can access it after claiming. Files are stored privately — workers receive a time-limited download link. Max 5 attachments per task. Task must be open or claimed. Supply either fileUrl (public download URL; local MCP package only — the hosted endpoint refuses it) OR fileData+mimeType (base64-encoded bytes) — not both.',
        {
            taskId: idSchema('taskId').describe('The task ID to attach the file to'),
            filename: z.string().min(1).max(255).describe('Display name for the attachment (e.g. "storefront_reference.jpg")'),
            fileUrl: z.string().url().optional()
                .describe('A publicly accessible URL to the file (JPEG/PNG/WebP ≤8 MB, PDF ≤25 MB, MP4/WebM/MOV ≤30 MB). The server will download and re-upload it. Use this OR fileData, not both.'),
            fileData: z.string().optional()
                .describe('Base64-encoded file contents. Use instead of fileUrl for files that cannot be given a public URL (e.g. generated files, private data). Must be accompanied by mimeType.'),
            mimeType: z.string().optional()
                .describe('MIME type of the file when using fileData (e.g. "image/jpeg", "application/pdf", "video/mp4"). Required when fileData is provided; ignored when fileUrl is used.'),
        },
        async (args) => {
            // Cross-field validation (SDK only accepts flat ZodRawShape, so validate here)
            const hasUrl = args.fileUrl != null;
            const hasData = args.fileData != null;
            if (!hasUrl && !hasData) {
                return error({ message: 'Provide either fileUrl (public download URL) or fileData (base64-encoded bytes) — one is required.' });
            }
            if (hasUrl && hasData) {
                return error({ message: 'Provide either fileUrl or fileData, not both.' });
            }
            if (hasData && !args.mimeType) {
                return error({ message: 'mimeType is required when supplying fileData.' });
            }
            const source = hasUrl
                ? { type: 'url' as const, url: args.fileUrl! }
                : { type: 'base64' as const, data: args.fileData!, mimeType: args.mimeType! };
            return wrap(() => api.uploadAttachment(args.taskId, args.filename, source));
        }
    );
}


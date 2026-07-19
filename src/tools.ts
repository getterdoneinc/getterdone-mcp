/**
 * Register all 19 MCP tools on the server instance.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient, ApiError } from './api-client.js';
import type { Credentials } from './credentials.js';

// ── Types ────────────────────────────────────────────────

type ToolResult = {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
};

// ── Helpers ──────────────────────────────────────────────

function success(data: unknown): ToolResult {
    return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
}

function error(err: unknown): ToolResult {
    const apiErr = err as ApiError;
    const message = apiErr?.message
        ? `[${apiErr.code ?? 'error'}] ${apiErr.message}`
        : String(err);
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

// ── Registration ─────────────────────────────────────────

export function registerTools(server: McpServer, api: ApiClient, agentId: string, creds?: Credentials): void {

    // 1. create_task
    server.tool(
        'create_task',
        "Post a new task to the GetterDone marketplace. Funding is automatic: the AgentOwner's card is secured for reward + platform fee at creation (an authorization captured at proof submission for deadlines ≤6 days; an immediate charge otherwise), drawing against the active funding token — no need to call fund_account first. Deadlines beyond 6 days (expiresInHours > 144) require Established or Business owner-account standing — Emerging (new) accounts get 403 with code LONG_DEADLINE_REQUIRES_VERIFICATION; use a shorter deadline (Established standing is earned automatically through platform track record, there is nothing to apply for). May return 429 with code OPEN_TASK_LIMIT (too many concurrent open tasks) or TASK_CREATION_LIMIT (too many created in the rolling 24h window), enforced per agent and per owner account and counting cancelled/expired tasks; these are durable caps distinct from the request rate limiter — back off and retry later rather than hammering.",
        {
            title: z.string().min(5).max(150).describe("Short title (e.g., 'Buy coffee at Starbucks on 5th Ave')"),
            description: z.string().min(20).max(5000).describe('Detailed instructions for the worker'),
            reward: z.number().min(1).max(100).describe('USD amount to pay the worker ($1–$100)'),
            category: z.enum(['General', 'Research', 'Data Entry', 'Writing', 'Design', 'Photography', 'Delivery', 'Handyman', 'Errands', 'Translation', 'Customer Service', 'Verification', 'Inspection', 'Mystery Shopping', 'Promotion', 'Proofreading', 'Video', 'Voice & Audio', 'Social Media', 'Other']).default('General').describe('Task category'),
            lat: z.number().optional().describe('Location latitude (optional when remote=true)'),
            lng: z.number().optional().describe('Location longitude (optional when remote=true)'),
            locationLabel: z.string().max(200).optional().describe('Human-readable address (optional when remote=true)'),
            remote: z.boolean().default(false).describe('Set true for any task that does not require the worker to be at a physical location — including image-only tasks, research tasks, writing, or any remotely-fulfilled work. If omitted or false, you MUST supply lat, lng, and locationLabel.'),
            expiresInHours: z.number().min(0.5).max(720).default(24).describe('Hours until auto-expiry if unclaimed (0.5–720, i.e. 30 min minimum). Values >144 (6 days) require Established/Business owner-account standing.'),
            keywords: z.array(z.string().max(50)).max(20).optional().describe('Keywords required in worker proof (max 20, each max 50 chars inclusive — a 50-character keyword is valid)'),
            minImages: z.number().int().min(0).max(10).optional().describe('Minimum images required in worker proof (0–10). Pass 0 to explicitly record no image requirement. Omit entirely to leave reviewCriteria unset.'),
            minVideos: z.number().int().min(0).max(3).optional().describe('Minimum video clips required in worker proof (0–3). Workers may upload up to 3 clips (MP4/WebM/MOV, max 30 MB each). Omit if no video requirement.'),
            minTrustScore: z.number().int().min(0).max(100).optional().describe('Minimum worker trust score to claim this task (0–100, default: open to all)'),
            tags: z.array(z.string().max(50)).max(10).optional().describe('Optional labels for searchability (max 10 tags, each max 50 chars, no HTML). Agents and workers can search by tag via the q= filter on list_tasks.'),
        },
        async (args) => wrap(() => api.createTask({
            title: args.title,
            description: args.description,
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
        }))
    );

    // 2. list_tasks
    server.tool(
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
    server.tool(
        'get_pending_reviews',
        [
            "Fetch all submitted tasks currently awaiting your approval decision — the complete pending-review queue in one call.",
            "",
            "Each task in the response includes:",
            "  • proofOfWork       — worker's submitted text, image URLs, and video URLs",
            "  • criteriaCheckResult — automated syntactic check (passed, score 0–100, per-check details)",
            "  • imageAuthenticityResult — reverse-image-search result (clean / likely_stock / suspicious / skipped)",
            "",
            "⚠️  CRITICAL — 24-hour review deadline: once a task reaches 'submitted', you have exactly 24 hours",
            "from submittedAt to call approve_task or dispute_task. After that, the platform auto-approves",
            "and releases payment regardless of proof quality. Always process this queue promptly.",
            "",
            "⚠️  The criteriaCheckResult is SYNTACTIC only — a keyword 'receipt' matches even if the worker",
            "wrote 'I could not find the receipt.' You must read the proof text yourself before deciding.",
            "",
            "Use this tool in your polling loop instead of list_tasks({ status: 'submitted' }) — it returns",
            "fully hydrated tasks so you do not need follow-up get_task calls for each item.",
            "",
            "If imageAuthenticityResult is absent on a task, wait ~5 seconds and call get_task — the",
            "Vision API check runs asynchronously and may not be complete yet.",
        ].join('\n'),
        {},
        async () => wrap(() => api.getPendingReviews(agentId))
    );

    // 4. get_task
    server.tool(
        'get_task',
        'Get full details for a specific task, including proof-of-work submissions and dispute history.',
        {
            taskId: z.string().describe('The unique task ID'),
        },
        async (args) => wrap(() => api.getTask(args.taskId))
    );

    // 4. approve_task
    server.tool(
        'approve_task',
        'Approve a submitted task, release escrowed funds to the worker. This is IRREVERSIBLE.',
        {
            taskId: z.string().describe('The task ID to approve'),
        },
        async (args) => wrap(() => api.approveTask(args.taskId))
    );

    // 5. dispute_task
    server.tool(
        'dispute_task',
        "Dispute a submitted task's proof-of-work. The worker will be notified and may contest.",
        {
            taskId: z.string().describe('The task ID to dispute'),
            reason: z.string().min(10).max(2000).describe('Detailed reason why the proof is insufficient (10–2000 chars)'),
        },
        async (args) => wrap(() => api.disputeTask(args.taskId, args.reason))
    );

    // 6. cancel_task
    server.tool(
        'cancel_task',
        'Cancel an open task. For normal (≤6-day-deadline) tasks the card hold is released — nothing was ever charged; long-deadline charged-at-posting tasks are refunded to the card. Cannot cancel claimed or submitted tasks.',
        {
            taskId: z.string().describe('The task ID to cancel'),
        },
        async (args) => wrap(() => api.cancelTask(args.taskId))
    );

    // 7. fund_account
    server.tool(
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
    server.tool(
        'get_balance',
        "Get the agent's wallet balance and pending escrow. Under direct-charge funding, create_task charges the AgentOwner's card per task, so balance is informational (it reflects any legacy wallet credit) and pendingEscrow sums escrow held across the agent's active tasks. Returns: { balance, pendingEscrow, currency }.",
        {},
        async () => wrap(() => api.getBalance())
    );

    // 8b. get_funding_status
    server.tool(
        'get_funding_status',
        "Pre-flight readiness check before creating paid tasks — use this (not get_balance) to verify setup. A successful call proves your credentials are valid; ready:true means the Agent Owner setup is complete (KYC + vaulted card + active funding token) and create_task will not fail with 402 NO_FUNDING_TOKEN. When ready is false, surface onboardingUrl to your developer — it deep-links the one-time Agent Owner setup pre-filled for this agent. Returns: { ready, hasActiveFundingToken, ownerKycStatus, onboardingUrl? }.",
        {},
        async () => wrap(() => api.getFundingStatus())
    );

    // 9. rate_worker
    server.tool(
        'rate_worker',
        'Leave a 1–5 star rating for a worker after task completion. Must be within the 24-hour window.',
        {
            taskId: z.string().describe('The completed task ID'),
            score: z.number().int().min(1).max(5).describe('Star rating (1 = poor, 5 = excellent)'),
            comment: z.string().optional().describe('Optional text feedback'),
        },
        async (args) => wrap(() => api.rateWorker(args.taskId, args.score, args.comment))
    );

    // 10. get_reputation
    server.tool(
        'get_reputation',
        "Quick reputation snapshot for any agent: reliability tier (excellent/good/caution/unreliable/new), dispute rate, worker rating average, and disputesLost (a durable count of disputes an admin decided against the agent — monotonic, not reset by resolving disputes). Use this to check your own standing or vet another agent. For your own full performance dashboard (balance, task counts by status, total spend), use get_agent_metrics instead.",
        {
            agentId: z.string().optional().describe('Agent ID to look up. Omit to get your own reputation.'),
        },
        async (args) => wrap(() => api.getReputation(args.agentId ?? agentId))
    );

    // 11. configure_webhook
    server.tool(
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
    server.tool(
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
    server.tool(
        'events_ack',
        'Acknowledge inbox events up to a cursor (high-water mark): everything with seq ≤ cursor is marked consumed, so your next cursor-less events_poll resumes after it. Call this with the nextCursor from events_poll AFTER you have processed that batch — acking before processing risks losing events if you crash. Acking a lower cursor than before is a harmless no-op.',
        {
            cursor: z.number().int().min(0).describe('The nextCursor value from the events_poll batch you just finished processing.'),
        },
        async (args) => wrap(() => api.ackEvents(args.cursor))
    );

    // 12. report_platform_issue
    server.tool(
        'report_platform_issue',
        'Submit a bug report, feature request, or general observation to the GetterDone platform admins. Use this when you encounter an API inconsistency, unexpected behaviour, or have a suggestion.',
        {
            type: z.enum(['bug', 'feature_request', 'general']).describe("Type of feedback: 'bug' for errors/inconsistencies, 'feature_request' for suggestions, 'general' for other observations"),
            title: z.string().min(3).max(120).describe('Short summary of the issue or request (max 120 chars)'),
            description: z.string().min(10).max(2000).describe('Detailed description including steps to reproduce, expected vs actual behaviour, or the rationale for the feature request'),
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
    server.tool(
        'get_worker_profile',
        "Get a worker's public profile including their trust tier, star rating, task completion stats, and recent ratings from agents. Use this to vet a worker before assigning high-value tasks.",
        {
            workerId: z.string().describe("The worker's unique user ID (found in task.workerId)"),
        },
        async (args) => wrap(() => api.getWorkerProfile(args.workerId))
    );

    // 14. get_agent_metrics
    server.tool(
        'get_agent_metrics',
        "Full performance dashboard for your own agent account: current balance, task count broken down by status (open/claimed/submitted/completed/disputed/expired), total platform spend, reputation stats, and recent worker ratings. Use this for operational reporting or when a user asks for an account summary. For a quick reliability-tier check on any agent (including other agents), use get_reputation instead.",
        {},
        async () => wrap(() => api.getAgentMetrics(agentId))
    );

    // 15. upload_attachment
    server.tool(
        'upload_attachment',
        'Upload a reference file (image, PDF, or short video) to a task so the assigned worker can access it after claiming. Files are stored privately — workers receive a time-limited download link. Max 5 attachments per task. Task must be open or claimed. Supply either fileUrl (public download URL) OR fileData+mimeType (base64-encoded bytes) — not both.',
        {
            taskId: z.string().describe('The task ID to attach the file to'),
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


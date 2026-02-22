/**
 * Register all 12 MCP tools on the server instance.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient, ApiError } from './api-client.js';

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

export function registerTools(server: McpServer, api: ApiClient, agentId: string): void {

    // 1. create_task
    server.tool(
        'create_task',
        "Post a new task to the GetterDone marketplace. Funds are automatically escrowed from the agent's balance.",
        {
            title: z.string().min(5).max(150).describe("Short title (e.g., 'Buy coffee at Starbucks on 5th Ave')"),
            description: z.string().min(20).max(5000).describe('Detailed instructions for the worker'),
            reward: z.number().min(1).max(100).describe('USD amount to pay the worker ($1–$100)'),
            category: z.enum(['General', 'Research', 'Data Entry', 'Writing', 'Design', 'Photography', 'Delivery', 'Shopping', 'Handyman', 'Errands', 'Translation', 'Physical Task', 'Customer Service', 'Other']).default('General').describe('Task category'),
            lat: z.number().optional().describe('Location latitude (optional when remote=true)'),
            lng: z.number().optional().describe('Location longitude (optional when remote=true)'),
            locationLabel: z.string().max(200).optional().describe('Human-readable address (optional when remote=true)'),
            remote: z.boolean().default(false).describe('Set true for location-independent tasks'),
            expiresInHours: z.number().min(1).max(720).default(24).describe('Hours until auto-expiry if unclaimed (1–720)'),
            keywords: z.array(z.string().max(50)).max(20).optional().describe('Keywords required in worker proof (max 20, each max 50 chars)'),
            minImages: z.number().int().min(1).max(50).optional().describe('Minimum images required in worker proof (1–50)'),
            minTrustScore: z.number().int().min(0).max(100).optional().describe('Minimum worker trust score to claim this task (0–100, default: open to all)'),
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
            reviewCriteria: (args.keywords || args.minImages)
                ? { keywords: args.keywords, minImages: args.minImages }
                : undefined,
            minTrustScore: args.minTrustScore,
        }))
    );

    // 2. list_tasks
    server.tool(
        'list_tasks',
        "List the agent's own tasks, optionally filtered by status.",
        {
            status: z.enum(['open', 'claimed', 'submitted', 'completed', 'disputed', 'contested', 'expired', 'all']).default('all').describe('Filter by status'),
            limit: z.number().min(1).max(50).default(20).describe('Max results'),
        },
        async (args) => wrap(() => api.listTasks({ status: args.status, limit: args.limit }))
    );

    // 3. get_task
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
        'Cancel an open task and refund escrowed funds. Cannot cancel claimed or submitted tasks.',
        {
            taskId: z.string().describe('The task ID to cancel'),
        },
        async (args) => wrap(() => api.cancelTask(args.taskId))
    );

    // 7. fund_account
    server.tool(
        'fund_account',
        "Add funds to the agent's wallet.",
        {
            amount: z.number().min(1).describe('USD amount to add (minimum $1.00)'),
            paymentMethodNonce: z.string().optional().describe('Braintree nonce (optional in sandbox)'),
        },
        async (args) => wrap(() => api.fundAccount(args.amount, args.paymentMethodNonce))
    );

    // 8. get_balance
    server.tool(
        'get_balance',
        "Get the agent's current wallet balance.",
        {},
        async () => wrap(() => api.getBalance())
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
        "Get an agent's reputation composite including completion rate, dispute history, and reliability tier.",
        {
            agentId: z.string().optional().describe('Agent ID. Omit to get your own reputation.'),
        },
        async (args) => wrap(() => api.getReputation(args.agentId ?? agentId))
    );

    // 11. configure_webhook
    server.tool(
        'configure_webhook',
        'Register or update a webhook URL for real-time event notifications.',
        {
            url: z.string().url().refine(
                (u) => u.startsWith('https://'),
                'Webhook URL must use HTTPS'
            ).describe('HTTPS URL to receive webhook POST requests'),
        },
        async (args) => wrap(() => api.configureWebhook(args.url))
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
}

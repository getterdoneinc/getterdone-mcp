/**
 * MCP resources and prompt templates.
 *
 * Resources: getterdone://balance, getterdone://tasks/active, getterdone://reputation, getterdone://skill
 * Prompts:   review_submission, create_errand, fund_account
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from './api-client.js';
import { z } from 'zod';

// ── Resources ────────────────────────────────────────────

export function registerResources(server: McpServer, api: ApiClient, agentId: string): void {

    // Balance
    server.resource(
        'balance',
        'getterdone://balance',
        { description: "Agent's current wallet balance and pending escrow" },
        async () => {
            try {
                const data = await api.getBalance();
                return {
                    contents: [{
                        uri: 'getterdone://balance',
                        mimeType: 'application/json',
                        text: JSON.stringify(data, null, 2),
                    }],
                };
            } catch {
                return {
                    contents: [{
                        uri: 'getterdone://balance',
                        mimeType: 'application/json',
                        text: '{"error": "Failed to fetch balance"}',
                    }],
                };
            }
        }
    );

    // Active tasks
    server.resource(
        'active_tasks',
        'getterdone://tasks/active',
        { description: "Agent's currently open, claimed, or submitted tasks" },
        async () => {
            try {
                const data = await api.listTasks({ status: 'open,claimed,submitted' });
                return {
                    contents: [{
                        uri: 'getterdone://tasks/active',
                        mimeType: 'application/json',
                        text: JSON.stringify(data, null, 2),
                    }],
                };
            } catch {
                return {
                    contents: [{
                        uri: 'getterdone://tasks/active',
                        mimeType: 'application/json',
                        text: '{"error": "Failed to fetch active tasks"}',
                    }],
                };
            }
        }
    );

    // Reputation
    server.resource(
        'reputation',
        'getterdone://reputation',
        { description: "Agent's reputation composite and reliability tier" },
        async () => {
            try {
                const data = await api.getReputation(agentId);
                return {
                    contents: [{
                        uri: 'getterdone://reputation',
                        mimeType: 'application/json',
                        text: JSON.stringify(data, null, 2),
                    }],
                };
            } catch {
                return {
                    contents: [{
                        uri: 'getterdone://reputation',
                        mimeType: 'application/json',
                        text: '{"error": "Failed to fetch reputation"}',
                    }],
                };
            }
        }
    );

    // Skill document — always returns the latest SKILL.md from the platform
    // Use this resource at the start of each session to check for skill updates.
    server.resource(
        'skill',
        'getterdone://skill',
        { description: 'Latest GetterDone Skill document (SKILL.md). Re-read at session start to detect version updates.' },
        async () => {
            try {
                const apiUrl = (api as unknown as { baseUrl?: string }).baseUrl
                    ?? 'https://getterdone.ai';
                const res = await fetch(`${apiUrl}/api/docs/spec?doc=skill`);
                const text = await res.text();
                return {
                    contents: [{
                        uri: 'getterdone://skill',
                        mimeType: 'text/markdown',
                        text,
                    }],
                };
            } catch {
                return {
                    contents: [{
                        uri: 'getterdone://skill',
                        mimeType: 'text/markdown',
                        text: '# GetterDone Skill\n\nFailed to fetch latest skill document. See https://getterdone.ai/api/docs/spec?doc=skill',
                    }],
                };
            }
        }
    );
}

// ── Prompts ──────────────────────────────────────────────

export function registerPrompts(server: McpServer, creds?: import('./credentials.js').Credentials): void {

    // review_submission — guide agent through reviewing a worker's proof
    server.prompt(
        'review_submission',
        'Review a worker submission and decide whether to approve or dispute. IMPORTANT: always present proof to the user and wait for their explicit A/D decision before calling approve_task or dispute_task.',

        { taskId: z.string().describe('The task ID to review') },
        async ({ taskId }) => ({
            messages: [{
                role: 'user' as const,
                content: {
                    type: 'text' as const,
                    text: [
                        `Please review the submission for task ${taskId}.`,
                        '',
                        '## Step 1 — Fetch the task',
                        `Call \`get_task\` with taskId "${taskId}" to retrieve the full task details.`,
                        '',
                        '## Step 2 — Present proof to me (REQUIRED — do not skip)',
                        'After fetching, display all of the following to me before taking any action:',
                        '',
                        '  ——————————————————————————',
                        '  📎 Task "[title]" has been submitted for review.',
                        '',
                        '  Worker\'s proof:',
                        '    • Text: "[proofOfWork.text]"',
                        '    • Images: [list each image URL or "none"]',
                        '    • Authenticity: [imageAuthenticityResult.overallFlag — clean / suspicious / likely_stock / skipped]',
                        '    • Criteria check: [criteriaCheckResult.passed true/false, score]',
                        '  ——————————————————————————',
                        '',
                        'Note: The criteria check is SYNTACTIC only — a keyword "receipt" matches even if the',
                        'worker wrote "I could not find the receipt." Read the proof text carefully yourself.',
                        'If imageAuthenticityResult is not yet populated, wait ~5 seconds and re-fetch.',
                        '',
                        '## Step 3 — Ask for my explicit decision (do NOT skip ahead)',
                        'Present the proof above and ask:',
                        '',
                        '  [A] Approve — release $[reward] to the worker (IRREVERSIBLE)',
                        '  [D] Dispute — reject the submission (worker will be notified)',
                        '',
                        'Do NOT call approve_task or dispute_task until I have responded with A or D.',
                        '',
                        '## Step 4a — If I choose Approve',
                        'Before calling approve_task, ask me for a rating:',
                        '',
                        '  "Please rate this worker (1–5 stars) and optionally leave a comment:"',
                        '    Stars (1–5): ___',
                        '    Comment (optional): ___________________________',
                        '',
                        'Then call both tools in sequence:',
                        `  approve_task({ taskId: "${taskId}" })   // irreversible — releases escrow`,
                        `  rate_worker({ taskId: "${taskId}", score: <stars>, comment: "<comment>" })`,
                        '',
                        'The rating window closes 24 hours after completion — always rate at approval time.',
                        '',
                        '## Step 4b — If I choose Dispute',
                        'Ask me for a specific reason before calling dispute_task:',
                        '',
                        '  "Please describe why you are rejecting this submission. Be specific —',
                        '  the worker can contest and an admin may review your reason:"',
                        '    Reason: ___________________________',
                        '',
                        '  (Minimum 10 characters — one-word reasons like "fake" will be rejected by the API.)',
                        '',
                        `Then call: dispute_task({ taskId: "${taskId}", reason: "<my reason>" })`,
                        '',
                        'The worker may contest the dispute. If they do, show me their response and ask',
                        'whether I want to maintain or withdraw the dispute.',
                    ].join('\n'),
                },
            }],
        })
    );

    // create_errand — guide agent through structured task creation
    server.prompt(
        'create_errand',
        'Create a well-structured physical errand from a high-level objective',
        { objective: z.string().describe("What the agent wants accomplished (e.g., 'verify business hours of Joe's Pizza')") },
        async ({ objective }) => ({
            messages: [{
                role: 'user' as const,
                content: {
                    type: 'text' as const,
                    text: [
                        `I want to create a GetterDone task from this objective: "${objective}"`,
                        '',
                        'Please help me structure this into a well-defined task:',
                        '',
                        '1. **Title** — A short, clear summary (< 80 chars)',
                        '2. **Description** — Step-by-step instructions for the worker',
                        '3. **Location** — Where the task needs to happen (lat, lng, label)',
                        '4. **Reward** — Fair compensation ($5–$100)',
                        '5. **Category** — General, Research, Data Entry, Writing, Design, Photography, Delivery, Handyman, Errands, Translation, Customer Service, Verification, Inspection, Mystery Shopping, Promotion, Proofreading, Video, Voice & Audio, Social Media, or Other',
                        '6. **Review Criteria** — Keywords and minimum images to verify completion',
                        '',
                        'Once you have all the details, call `create_task` with the structured payload.',
                        'If the objective is location-independent, set remote to true.',
                    ].join('\n'),
                },
            }],
        })
    );

    // fund_account — guide agent through funding wallet or directing owner to one-time setup
    server.prompt(
        'fund_account',
        'Add funds to this agent wallet, or guide the owner through one-time setup if no active funding token exists',
        { amount: z.number().min(1).describe('USD amount to add (minimum $1.00)') },
        async ({ amount }) => {
            const ownerUrl = `${creds?.apiUrl ?? 'https://getterdone.ai'}/agent-owner`;
            const agentId = creds?.agentId ?? '<your-agent-id>';
            // Embed agentId in URL so the funding token form is pre-filled when the owner arrives
            const ownerUrlWithAgent = creds?.agentId
                ? `${ownerUrl}?agentId=${encodeURIComponent(creds.agentId)}`
                : ownerUrl;

            const lines = [
                `I need to add $${amount.toFixed(2)} to my GetterDone wallet.`,
                '',
                '## How this works',
                '',
                'The server automatically finds my active funding token — **I never need to',
                'know or store the token string.** I just call:',
                '```',
                `fund_account({ amount: ${amount} })`,
                '```',
                'The server looks up my active token by agent ID and charges my owner\'s card.',
                '',
                '## If I get "no active funding token found"',
                '',
                `My owner needs to do a **one-time setup** at:`,
                `**${ownerUrlWithAgent}**`,
                `(The Agent ID field will be pre-filled automatically.)`,
                '',
                '1. Sign in with Google or GitHub.',
                '2. Register (name + email).',
                '3. Pass Stripe Identity KYC (government ID, ~2 minutes).',
                '4. Add a credit/debit card.',
                `5. Create a Funding Token for Agent ID: \`${agentId}\``,
                `   with an amount limit of at least **$${amount.toFixed(2)}**.`,
                '',
                '**That is all.** Once the token is created, every future `fund_account` call',
                'works automatically — the owner never needs to share the token string with me.',
            ];

            return {
                messages: [{
                    role: 'user' as const,
                    content: { type: 'text' as const, text: lines.join('\n') },
                }],
            };
        }
    );
}

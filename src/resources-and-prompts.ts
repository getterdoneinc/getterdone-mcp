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
        'Review a worker submission and decide whether to approve or dispute',
        { taskId: z.string().describe('The task ID to review') },
        async ({ taskId }) => ({
            messages: [{
                role: 'user' as const,
                content: {
                    type: 'text' as const,
                    text: [
                        `Please review the submission for task ${taskId}.`,
                        '',
                        'Steps:',
                        `1. First, call the \`get_task\` tool with taskId "${taskId}" to fetch the full task details.`,
                        '2. Compare the worker\'s proof-of-work against the original task requirements.',
                        '3. Check if any review criteria (keywords, minimum images) are satisfied.',
                        '4. Make a decision:',
                        `   - If the proof satisfies the requirements → call \`approve_task\` with taskId "${taskId}"`,
                        `   - If the proof is insufficient → call \`dispute_task\` with taskId "${taskId}" and a detailed reason (min 10 chars)`,
                        '',
                        'Important: Approving is IRREVERSIBLE and releases the escrowed funds to the worker.',
                        'When in doubt, ask me for clarification before approving.',
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
                        '4. **Reward** — Fair compensation ($1–$100)',
                        '5. **Category** — General, Delivery, Photography, Research, or Physical Task',
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

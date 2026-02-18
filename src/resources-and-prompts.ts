/**
 * MCP resources and prompt templates.
 *
 * Resources: getterdone://balance, getterdone://tasks/active, getterdone://reputation
 * Prompts:   review_submission, create_errand
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
}

// ── Prompts ──────────────────────────────────────────────

export function registerPrompts(server: McpServer): void {

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
}

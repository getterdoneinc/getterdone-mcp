/**
 * Server-level `instructions` for the MCP `initialize` handshake.
 *
 * A host that connects by URL (ChatGPT / dots, Claude connectors, Cursor /
 * Grok Bot, Muse) loads the tool descriptions and nothing else: resources
 * such as `getterdone://skill` are user-attached at best and ignored by
 * some hosts, so the platform mechanics in `docs/agents/SKILL.md` never
 * reach the model. The `instructions` field is the one channel every
 * spec-compliant host feeds into the model's context without user action
 * (the SDK surfaces it as `client.getInstructions()`), so this is the
 * condensed skill: the rules a model must know before it spends money or
 * judges human work. Keep it short — hosts put it in the system prompt.
 *
 * Source of truth for the rules is SKILL.md §2–§6; when those change,
 * change this. The full document stays available through the skill
 * resource for hosts that expose resources.
 */

export interface InstructionsContext {
    /**
     * Consumer-agent connection (connector-shaped OAuth client): `create_task`
     * requires the `confirmationToken` from `quote_task` (CONNECT-01 §5).
     */
    connector: boolean;
    /** Public origin of the app, used for the dashboard and policy links. */
    origin: string;
}

export function buildServerInstructions(ctx: InstructionsContext): string {
    const origin = ctx.origin.replace(/\/$/, '');
    const quoteRule = ctx.connector
        ? 'Every create_task on this connection MUST be preceded by quote_task: show the user the exact total it returns, get their go-ahead, then pass its confirmationToken (valid 10 minutes, bound to the same fields) to create_task. A create_task without it is refused with QUOTE_MISMATCH.'
        : 'quote_task returns the exact total before anything is charged; use it to confirm the cost with the user, then pass its confirmationToken to create_task.';

    return [
        'GetterDone hires a real human worker for a physical, in-person task (go somewhere, check or photograph something, pick something up, stand in a line) and pays them from the account owner\'s card. Read these rules before using the tools.',
        '',
        '1. Time scale. Human work is asynchronous: a task takes 30 minutes to several days. create_task returns at once with status "open"; a worker claims it later, does the work and submits text + photo proof. Check progress with get_pending_reviews, events_poll or a webhook (configure_webhook) rather than waiting in a loop.',
        '',
        `2. Money. The owner's card is secured for reward + platform fee when a task is created and paid out to the worker only when the proof is approved. Nothing here adds money to the account: a 402 NO_FUNDING_TOKEN means the owner has not pre-authorised spending for this agent; relay the onboardingUrl from the error so they can issue a funding token (single-use by default: one task per token). ${quoteRule}`,
        '',
        `3. Confirm before you spend. Never call create_task, approve_task or dispute_task without the user's explicit yes for that specific action. Before posting, show the title, what the worker will do, the reward and the total charged, the location (or remote), the deadline and the proof required, and point out anything in the text a stranger should not see (home addresses, full names, phone numbers, licence plates, minors, account or document numbers). Refuse tasks that break the Acceptable Use Policy (${origin}/legal/acceptable-use) and offer a revised scope.`,
        '',
        '4. Review proof yourself, within 24 hours. When a task is "submitted" you have 24 hours from submittedAt to call approve_task or dispute_task; after that the worker is paid automatically. criteriaCheckResult is a syntactic keyword and media-count check, not a judgement: "I could not find the receipt" passes the keyword "receipt". Read proofOfWork.text and look at the images (the review_submission prompt walks through it) and wait while checksPending is true. Show the proof to the user and let them choose: approve (irreversible, pays the worker; then call rate_worker, the rating window closes 24 hours later) or dispute (a specific reason of at least 10 characters; the worker has 48 hours to contest and an admin may adjudicate; every dispute permanently counts toward your dispute rate, so dispute deficient work, not borderline work).',
        '',
        '5. Normal states that are not errors. "completed" with payoutHoldUntil set means the platform pays the worker later; nothing to do. A 402 from approve_task means retry the same call shortly (idempotent). "suspended" means workers flagged the task; approve, dispute and cancel return 422 until an admin resolves it. "expired", "cancelled" and "resolved" return the secured funds to the owner. 429 OPEN_TASK_LIMIT or TASK_CREATION_LIMIT are durable caps: back off, do not retry in a loop.',
        '',
        '6. Limits. Deadlines over 6 days (expiresInHours > 144) need identity verification and Established owner standing (403 LONG_DEADLINE_REQUIRES_VERIFICATION): use a shorter deadline. cancel_task works only while the task is unclaimed.',
        '',
        `The full skill document is the getterdone://skill resource (also ${origin}/api/docs/spec?doc=skill). The owner's dashboard is ${origin}/agent-owner.`,
    ].join('\n');
}

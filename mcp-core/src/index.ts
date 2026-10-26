/**
 * @getterdone/mcp-core — the one MCP catalog for GetterDone.
 *
 * Consumed by two hosts (CONNECT-01 §2):
 *   - the hosted Streamable HTTP endpoint `https://getterdone.ai/mcp`
 *     (src/app/mcp/route.ts, bundled by Next via the tsconfig path alias)
 *   - the stdio package `@getterdone/mcp-server` (bundled by esbuild at build time)
 *
 * Tools execute by calling the REST API through `ApiClient`, so business
 * logic, authorisation, caps and moderation run once, in the routes.
 */
export { registerTools, TOOL_SCOPES, SANDBOX_RESULT_PREFIX, SANDBOX_MONEY_NOTE, type ToolOptions } from './tools';
export { registerResources, registerPrompts, type PromptContext } from './resources-and-prompts';
export { buildServerInstructions, type InstructionsContext } from './instructions';
export { ApiClient, type ApiError, type ApiResponse, type ApiClientOptions } from './api-client';
export { scopeGrantsWrite } from './scope';

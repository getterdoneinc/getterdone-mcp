/**
 * Scope helpers mirrored from src/lib/oauth.ts (the package cannot import the
 * app). Keep the two in sync — the MCP write gate and the REST write gate must
 * agree on what counts as a write scope.
 */
export function scopeGrantsWrite(scope: string | undefined): boolean {
    if (scope === undefined) return true; // client_credentials tokens carry no scope → full access
    const set = new Set(scope.split(/\s+/));
    return set.has('agent:full') || set.has('tasks:write');
}

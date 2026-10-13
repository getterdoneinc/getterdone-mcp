// Bundles src/index.ts + src/cli.ts into dist/ with @getterdone/mcp-core
// INLINED (it is a private, unpublished workspace package) and every real
// npm dependency left external. Run via `npm run build` (type-check first).
import { build, context } from 'esbuild';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

// The catalog lives at ../mcp-core in the monorepo; the public mirror
// (getterdoneinc/getterdone-mcp) vendors it at ./mcp-core via the sync
// workflow. Same list as tsconfig `paths` — keep them in step.
const CORE_CANDIDATES = [resolve(here, '../mcp-core/src/index.ts'), resolve(here, 'mcp-core/src/index.ts')];
const core = CORE_CANDIDATES.find((p) => existsSync(p));
if (!core) throw new Error(`@getterdone/mcp-core not found; looked in: ${CORE_CANDIDATES.join(', ')}`);

/** @type {import('esbuild').BuildOptions} */
const options = {
    entryPoints: [resolve(here, 'src/index.ts'), resolve(here, 'src/cli.ts')],
    outdir: resolve(here, 'dist'),
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    sourcemap: true,
    packages: 'external',
    alias: { '@getterdone/mcp-core': core },
    banner: { js: '#!/usr/bin/env node' },
    logLevel: 'info',
};

if (watch) {
    const ctx = await context(options);
    await ctx.watch();
} else {
    await build(options);
}

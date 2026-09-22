/**
 * Bundles and runs the SSR verification entry.
 *
 * Node cannot strip JSX on its own, so rolldown (already present via Vite)
 * compiles the entry to a single Node-executable module first.
 */
import { rolldown } from 'rolldown';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('.ssr', { recursive: true });

const bundle = await rolldown({
  input: 'scripts/ssr-entry.tsx',
  platform: 'node',
  resolve: { extensions: ['.tsx', '.ts', '.mjs', '.js', '.json'] },
});

await bundle.write({
  file: '.ssr/entry.mjs',
  format: 'esm',
  codeSplitting: false,
});
await bundle.close();

const res = spawnSync(process.execPath, ['.ssr/entry.mjs'], { stdio: 'inherit' });
process.exit(res.status ?? 1);

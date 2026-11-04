/**
 * Bundles and runs the SSR verification entry.
 *
 * Node cannot strip JSX on its own, so rolldown (already present via Vite)
 * compiles the entry to a single Node-executable module first.
 */
import { rolldown } from 'rolldown';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

mkdirSync('.ssr', { recursive: true });

async function runEntry(input, out) {
  const bundle = await rolldown({
    input,
    platform: 'node',
    resolve: { extensions: ['.tsx', '.ts', '.mjs', '.js', '.json'] },
  });
  await bundle.write({ file: out, format: 'esm', codeSplitting: false });
  await bundle.close();
  return spawnSync(process.execPath, [out], { stdio: 'inherit' }).status ?? 1;
}

let status = await runEntry('scripts/ssr-entry.tsx', '.ssr/entry.mjs');
try {
  readFileSync('fixtures/ioipg.json');
  const ioipgStatus = await runEntry('scripts/ssr-ioipg.tsx', '.ssr/ioipg-entry.mjs');
  status = status || ioipgStatus;
} catch {
  console.log('SKIP  fixtures/ioipg.json not found — run `npm run fixture:ioipg` locally.');
}
process.exit(status);

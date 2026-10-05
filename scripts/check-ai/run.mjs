// npm run check:ai — offline checks of the AI decision rules (no network, no database, no WhatsApp).
// Compiles the pure rule modules with tsc, then runs every *.test.cjs with Node's built-in test runner.
import { execSync, spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..', '..');
rmSync(join(root, '.check-build'), { recursive: true, force: true });
execSync('npx tsc -p tsconfig.check.json', { cwd: root, stdio: 'inherit' });
const files = readdirSync(here).filter(f => f.endsWith('.test.cjs')).sort().map(f => join(here, f));
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);

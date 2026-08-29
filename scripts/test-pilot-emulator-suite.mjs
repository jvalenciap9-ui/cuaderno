/**
 * Suite que se ejecuta DENTRO de firebase emulators:exec.
 */
import { spawnSync } from 'node:child_process';

for (const script of [
  'scripts/test-rules.mjs',
  'scripts/test-functions.mjs',
  'scripts/test-stats-admin.mjs',
]) {
  const result = spawnSync(process.execPath, [script], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('\nPASS — Rules, Functions y estadísticas en emuladores aislados.');

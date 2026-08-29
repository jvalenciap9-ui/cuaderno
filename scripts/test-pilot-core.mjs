/**
 * Puerta local rápida del piloto. No usa Firebase ni la red.
 */
import { spawnSync } from 'node:child_process';

const commands = [
  [process.execPath, ['scripts/test-class-groups.mjs']],
  [process.execPath, ['scripts/test-school-config.mjs']],
  [process.execPath, ['scripts/test-grading-weight.mjs']],
  [process.execPath, ['scripts/test-alerts.mjs']],
  [process.execPath, ['scripts/test-periodos-plan.mjs']],
  [process.execPath, ['scripts/test-search-student.mjs']],
  [process.execPath, ['scripts/test-risk-calculator.mjs']],
  [process.execPath, ['scripts/test-grading-policy.mjs']],
  [process.execPath, ['scripts/test-backup-validate.mjs']],
  [process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'lint']],
  [process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:staging']],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('\nPASS — núcleo del piloto, TypeScript y build de Staging.');

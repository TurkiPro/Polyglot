#!/usr/bin/env node
/**
 * Build the client bundle, then serve the PWA and the API together from one origin.
 * Node replaces bash here so `npm run dev` behaves identically in PowerShell, cmd,
 * and POSIX shells (CLAUDE.md §6.5). Extra CLI args are forwarded to wrangler:
 *   npm run dev -- --ip 0.0.0.0
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Run a command in the repo root, inheriting stdio; resolves on exit 0. */
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: 'inherit',
      // npm/npx are .cmd shims on Windows and need a shell to resolve.
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

try {
  await run('npm', ['run', 'build']);
  await run('npx', ['wrangler', 'dev', '--config', 'worker/wrangler.toml', ...process.argv.slice(2)]);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

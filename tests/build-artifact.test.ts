import { expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ICON_BASE64, ICON_SHA256 } from '../src/generated/icons';
import { buildPlugin } from '../scripts/build';

const metadata = [
  '// <xbar.title>Tibo Raccoon</xbar.title>',
  '// <xbar.version>v0.1.0</xbar.version>',
  '// <xbar.author>Hojin</xbar.author>',
  "// <xbar.desc>Watch Tibo's public posts from the macOS menu bar.</xbar.desc>",
  '// <xbar.dependencies>bun,swiftbar</xbar.dependencies>',
  '// <swiftbar.runInBash>false</swiftbar.runInBash>',
] as const;

test('builds one directly executable SwiftBar artifact without runtime assets or imports', async () => {
  const buildDirectory = await mkdtemp(join(tmpdir(), 'tibo-raccoon-build-'));
  const stateDirectory = await mkdtemp(join(tmpdir(), 'tibo-raccoon-state-'));
  const output = join(buildDirectory, 'tibo-raccoon.2m.js');

  try {
    await buildPlugin({ output, bunPath: process.execPath });
    const source = await readFile(output, 'utf8');

    expect(output.endsWith('/tibo-raccoon.2m.js')).toBe(true);
    expect(await readdir(buildDirectory)).toEqual(['tibo-raccoon.2m.js']);
    expect((await stat(output)).mode & 0o777).toBe(0o755);
    expect(source.startsWith(`#!${process.execPath}\n`)).toBe(true);
    for (const line of metadata) expect(source).toContain(line);
    for (const state of ['calm', 'unread', 'offline'] as const) {
      for (const appearance of ['light', 'dark'] as const) {
        expect(source).toContain(ICON_BASE64[state][appearance]);
        expect(source).toContain(ICON_SHA256[state][appearance]);
      }
    }
    expect(source).not.toContain('sourceMappingURL');
    expect(source).not.toContain('assets/icons');
    expect(source).not.toMatch(/(?:from|import)\s*['\"][./]/);
    expect(source).not.toMatch(/(?:from\s*|import\s*\()['\"](?:\.{1,2}\/|src\/|assets\/|tibo-raccoon-swiftbar)/);

    await writeFile(join(stateDirectory, '.tibo-raccoon-test-state'), 'tibo-raccoon-test-state-v1\n', { mode: 0o600 });
    const attemptedAt = new Date().toISOString();
    await writeFile(join(stateDirectory, 'state.json'), `${JSON.stringify({
      version: 1,
      initializedAt: attemptedAt,
      recoveryPending: false,
      knownIds: [],
      unreadIds: [],
      cachedPosts: [],
      lastAttemptAt: attemptedAt,
      lastSuccessAt: attemptedAt,
      consecutiveFailures: 0,
      nextRetryAt: null,
      lastError: null,
    })}\n`, { mode: 0o600 });
    await chmod(output, 0o755);

    const child = Bun.spawn([output], {
      env: {
        ...process.env,
        TIBO_RACCOON_TEST_MODE: '1',
        TIBO_RACCOON_TEST_STATE_DIR: stateDirectory,
        SWIFTBAR_PLUGIN_PATH: output,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const timeout = setTimeout(() => child.kill(), 5_000);
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    clearTimeout(timeout);

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    const lines = stdout.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^\|\s*image=[^\s]+\s+dropdown=false$/);
    expect(lines).toContain('---');
    expect(lines).toContain('Tibo Raccoon · 0 unread');
  } finally {
    await rm(buildDirectory, { recursive: true, force: true });
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

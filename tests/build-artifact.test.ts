import { expect, test } from 'bun:test';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ICON_BASE64, ICON_SHA256 } from '../src/generated/icons';
import { assertAllowedRuntimeImports, buildPlugin, extractRuntimeImportSpecifiers } from '../scripts/build';

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
  const secondBuildDirectory = await mkdtemp(join(tmpdir(), 'tibo-raccoon-build-'));
  const smokeRoot = await mkdtemp(join(tmpdir(), 'tibo-raccoon-smoke-'));
  const stateDirectory = await mkdtemp(join(smokeRoot, 'tibo-raccoon-state-'));
  const output = join(buildDirectory, 'tibo-raccoon.2m.js');
  const secondOutput = join(secondBuildDirectory, 'tibo-raccoon.2m.js');

  try {
    await buildPlugin({ output, bunPath: process.execPath });
    await buildPlugin({ output: secondOutput, bunPath: process.execPath });
    const source = await readFile(output, 'utf8');

    expect(output.endsWith('/tibo-raccoon.2m.js')).toBe(true);
    expect(await readdir(buildDirectory)).toEqual(['tibo-raccoon.2m.js']);
    expect(await readdir(secondBuildDirectory)).toEqual(['tibo-raccoon.2m.js']);
    expect(await readFile(secondOutput, 'utf8')).toBe(source);
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
    expect(extractRuntimeImportSpecifiers(source)).toEqual([
      'crypto',
      'fs',
      'fs/promises',
      'os',
      'path',
    ]);

    await writeFile(join(stateDirectory, '.tibo-raccoon-test-state'), 'tibo-raccoon-test-state-v1\n', { mode: 0o600 });
    await mkdir(join(smokeRoot, 'home'), { mode: 0o700 });
    const attemptedAt = '2026-08-30T00:00:00.000Z';
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
      nextRetryAt: '9999-12-31T23:59:59.999Z',
      lastError: null,
    })}\n`, { mode: 0o600 });
    await chmod(output, 0o755);

    const child = Bun.spawn([output], {
      env: {
        HOME: join(smokeRoot, 'home'),
        TMPDIR: smokeRoot,
        TIBO_RACCOON_TEST_MODE: '1',
        TIBO_RACCOON_TEST_STATE_DIR: stateDirectory,
        SWIFTBAR_PLUGIN_PATH: output,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await awaitChildExit(child, 5_000);
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    const lines = stdout.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^\|\s*image=[^\s]+\s+dropdown=false$/);
    expect(lines).toContain('---');
    expect(lines).toContain('Tibo Raccoon · 0 unread');
  } finally {
    await rm(buildDirectory, { recursive: true, force: true });
    await rm(secondBuildDirectory, { recursive: true, force: true });
    await rm(smokeRoot, { recursive: true, force: true });
  }
});

test('rejects an owner-unexecutable Bun path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tibo-raccoon-build-'));
  const bunPath = join(directory, 'bun');
  try {
    await writeFile(bunPath, '#!/bin/sh\n', { mode: 0o600 });
    await chmod(bunPath, 0o001);
    await expect(buildPlugin({ output: join(directory, 'tibo-raccoon.2m.js'), bunPath })).rejects.toThrow('Bun path must be an absolute executable path without whitespace');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects arbitrary runtime package imports', () => {
  expect(() => assertAllowedRuntimeImports('import leftPad from "left-pad";')).toThrow('Plugin artifact verification failed');
  expect(() => assertAllowedRuntimeImports('const leftPad = import("left-pad");')).toThrow('Plugin artifact verification failed');
});

test('rejects a computed dynamic import in emitted JavaScript', async () => {
  const emitted = await emitJavaScript('const target = process.argv[2]; void import(target);');
  expect(emitted).toContain('import(');
  expect(() => assertAllowedRuntimeImports(emitted)).toThrow('Plugin artifact verification failed');
});

test('extracts and allowlists emitted re-export specifiers', async () => {
  const emitted = await emitJavaScript('export * from "fs/promises"; export { readFile } from "fs";');
  expect(extractRuntimeImportSpecifiers(emitted)).toEqual(['fs', 'fs/promises']);
  expect(() => assertAllowedRuntimeImports(emitted)).not.toThrow();
});

test('rejects an emitted bare-package re-export', async () => {
  const emitted = await emitJavaScript('export * from "left-pad";', ['left-pad']);
  expect(extractRuntimeImportSpecifiers(emitted)).toEqual(['left-pad']);
  expect(() => assertAllowedRuntimeImports(emitted)).toThrow('Plugin artifact verification failed');
});

test('ignores import-looking strings and comments in emitted JavaScript', async () => {
  const emitted = await emitJavaScript('export const text = "import(\\\"left-pad\\\")"; // import("left-pad")');
  expect(extractRuntimeImportSpecifiers(emitted)).toEqual([]);
  expect(() => assertAllowedRuntimeImports(emitted)).not.toThrow();
});

async function emitJavaScript(source: string, external: string[] = []): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tibo-raccoon-import-scan-'));
  const entrypoint = join(directory, 'entry.js');
  try {
    await writeFile(entrypoint, source, { mode: 0o600 });
    const result = await Bun.build({ entrypoints: [entrypoint], target: 'bun', format: 'esm', minify: true, external });
    if (!result.success || result.outputs.length !== 1) throw new Error('Failed to emit JavaScript fixture');
    return await result.outputs[0]!.text();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function awaitChildExit(child: ReturnType<typeof Bun.spawn>, timeoutMs: number): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      child.exited.then((exitCode) => ({ timedOut: false as const, exitCode })),
      new Promise<{ timedOut: true }>((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      }),
    ]);
    if (!result.timedOut) return result.exitCode;

    child.kill(9);
    const killed = await Promise.race([
      child.exited.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000)),
    ]);
    if (!killed) throw new Error('Artifact process did not exit after SIGKILL');
    throw new Error(`Artifact process exceeded ${timeoutMs}ms`);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

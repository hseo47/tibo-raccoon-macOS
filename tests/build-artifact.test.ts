import { expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertAllowedRuntimeImports, buildPlugin, extractRuntimeImportSpecifiers, verifyArtifact } from '../scripts/build';

type IconState = 'calm' | 'unread' | 'offline';
type Appearance = 'light' | 'dark';

const EXPECTED_ICON_SHA256 = {
  calm: {
    light: '090ae57eb9ad9abde97c346708d406be92f779c8ca5785adf31fe2e9a5485ff0',
    dark: '1a0eb3a4467a0d7b874b648b02e6bd5ded97764bebd179b17a18da09b5998088',
  },
  unread: {
    light: 'e45715ffb73282da58f9bc25f5019e6fba5ae7448e7026657636c08d41868af0',
    dark: 'd5f106490ac25d2f731fa1f5c3ac4ebffa423a157662e64005b323c43a7a9443',
  },
  offline: {
    light: 'ab863510c457e6cd346bc264f21accc0b746d4b5be2cd9e7c9403fac4d6a5db6',
    dark: '0fbfe29c39fbfc201fb0841dae5390a52913ce0f73c430265c8a8f5c2725dfa7',
  },
} as const satisfies Record<IconState, Record<Appearance, string>>;

const metadata = [
  '// <xbar.title>Tibo Raccoon</xbar.title>',
  '// <xbar.version>v0.1.0</xbar.version>',
  '// <xbar.author>Hojin</xbar.author>',
  "// <xbar.desc>Watch Tibo's public posts from the macOS menu bar.</xbar.desc>",
  '// <xbar.dependencies>bun,swiftbar</xbar.dependencies>',
  '// <swiftbar.runInBash>false</swiftbar.runInBash>',
] as const;

test('builds one directly executable SwiftBar artifact and maps every runtime icon exactly', async () => {
  const buildDirectory = await mkdtemp(join(tmpdir(), 'tibo-raccoon-build-'));
  const secondBuildDirectory = await mkdtemp(join(tmpdir(), 'tibo-raccoon-build-'));
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
    expect(source).not.toContain('tibo-raccoon-icon-integrity');
    expect(source).not.toContain('sourceMappingURL');
    expect(source).not.toContain('assets/icons');
    expect(extractRuntimeImportSpecifiers(source)).toEqual([
      'crypto',
      'fs',
      'fs/promises',
      'os',
      'path',
    ]);

    await expectCanonicalAssets();

    const emittedBase64 = {} as Record<IconState, Record<Appearance, string>>;
    for (const iconState of ['calm', 'unread', 'offline'] as const) {
      const execution = await executeArtifact(output, iconState);
      expect(execution.exitCode).toBe(0);
      expect(execution.stderr).toBe('');
      expect(execution.lines).toContain('---');
      expect(execution.lines).toContain(`Tibo Raccoon · ${iconState === 'unread' ? 1 : 0} unread`);

      emittedBase64[iconState] = {} as Record<Appearance, string>;
      for (const appearance of ['light', 'dark'] as const) {
        const encoded = execution.images[appearance];
        emittedBase64[iconState][appearance] = encoded;
        expect(sha256(Buffer.from(encoded, 'base64'))).toBe(EXPECTED_ICON_SHA256[iconState][appearance]);
        expect(source).toContain(encoded);
      }
    }
    expect(new Set(Object.values(emittedBase64).flatMap(({ light, dark }) => [light, dark])).size).toBe(6);

    const tamperedDirectory = join(buildDirectory, 'tampered');
    const tamperedOutput = join(tamperedDirectory, 'tibo-raccoon.2m.js');
    await mkdir(tamperedDirectory, { mode: 0o700 });
    let tamperedSource = swapLiterals(source, emittedBase64.calm.light, emittedBase64.unread.light);
    tamperedSource = swapLiterals(tamperedSource, emittedBase64.calm.dark, emittedBase64.unread.dark);
    await writeFile(tamperedOutput, tamperedSource, { mode: 0o755 });
    await chmod(tamperedOutput, 0o755);
    await expect(verifyArtifact(tamperedOutput, process.execPath)).rejects.toThrow('Plugin artifact verification failed');
  } finally {
    await rm(buildDirectory, { recursive: true, force: true });
    await rm(secondBuildDirectory, { recursive: true, force: true });
  }
}, { timeout: 20_000 });

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

async function executeArtifact(output: string, iconState: IconState): Promise<{
  exitCode: number;
  stderr: string;
  lines: string[];
  images: Record<Appearance, string>;
}> {
  const executionRoot = await mkdtemp(join(tmpdir(), 'tibo-raccoon-artifact-exec-'));
  const home = join(executionRoot, 'home');
  const childTmp = join(executionRoot, 'tmp');
  const fallbackDirectory = join(home, 'Library', 'Application Support', 'Tibo Raccoon');
  await mkdir(home, { mode: 0o700 });
  await mkdir(childTmp, { mode: 0o700 });
  await mkdir(fallbackDirectory, { recursive: true, mode: 0o700 });
  const stateDirectory = await mkdtemp(join(childTmp, 'tibo-raccoon-state-'));
  const stateBody = `${JSON.stringify(canonicalState(iconState))}\n`;

  try {
    await writeFile(join(stateDirectory, '.tibo-raccoon-test-state'), 'tibo-raccoon-test-state-v1\n', { mode: 0o600 });
    await writeFile(join(stateDirectory, 'state.json'), stateBody, { mode: 0o600 });
    await writeFile(join(fallbackDirectory, 'state.json'), stateBody, { mode: 0o600 });

    const child = Bun.spawn([output], {
      env: {
        HOME: home,
        TMPDIR: childTmp,
        TIBO_RACCOON_TEST_MODE: '1',
        TIBO_RACCOON_TEST_STATE_DIR: stateDirectory,
        SWIFTBAR_PLUGIN_PATH: output,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await awaitChildExit(child, 5_000);
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const lines = stdout.trimEnd().split('\n');
    const header = lines[0] ?? '';
    const match = /^\| image=([^,\s]+),([^\s]+) dropdown=false$/.exec(header);
    if (match === null || match[1] === undefined || match[2] === undefined) {
      throw new Error('Artifact did not emit a valid SwiftBar image header');
    }
    return { exitCode, stderr, lines, images: { light: match[1], dark: match[2] } };
  } finally {
    await rm(executionRoot, { recursive: true, force: true });
  }
}

function canonicalState(iconState: IconState): object {
  const attemptedAt = '9999-12-31T23:59:58.000Z';
  const unread = iconState === 'unread';
  return {
    version: 1,
    initializedAt: '2026-08-30T00:00:00.000Z',
    recoveryPending: false,
    knownIds: unread ? ['new-post'] : [],
    unreadIds: unread ? ['new-post'] : [],
    cachedPosts: unread ? [{
      id: 'new-post',
      text: 'new post',
      publishedAt: '2026-08-30T00:01:00.000Z',
      url: 'https://x.com/thsottiaux/status/new-post',
    }] : [],
    lastAttemptAt: attemptedAt,
    lastSuccessAt: '2026-08-30T00:00:00.000Z',
    consecutiveFailures: iconState === 'offline' ? 3 : 0,
    nextRetryAt: '9999-12-31T23:59:59.999Z',
    lastError: iconState === 'offline' ? 'network' : null,
  };
}

async function expectCanonicalAssets(): Promise<void> {
  const manifest = JSON.parse(await readFile(join(import.meta.dir, '../assets/icons/sha256.json'), 'utf8')) as unknown;
  const expectedManifest = {
    'calm-dark.png': EXPECTED_ICON_SHA256.calm.dark,
    'calm-light.png': EXPECTED_ICON_SHA256.calm.light,
    'offline-dark.png': EXPECTED_ICON_SHA256.offline.dark,
    'offline-light.png': EXPECTED_ICON_SHA256.offline.light,
    'unread-dark.png': EXPECTED_ICON_SHA256.unread.dark,
    'unread-light.png': EXPECTED_ICON_SHA256.unread.light,
  };
  expect(manifest).toEqual(expectedManifest);
  for (const [filename, expectedHash] of Object.entries(expectedManifest)) {
    expect(sha256(await readFile(join(import.meta.dir, '../assets/icons', filename)))).toBe(expectedHash);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function swapLiterals(source: string, left: string, right: string): string {
  const placeholder = `__TIBO_RACCOON_SWAP_${randomUUID()}__`;
  if (source.includes(placeholder) || !source.includes(left) || !source.includes(right)) {
    throw new Error('Could not prepare artifact mapping mutation');
  }
  return source.replaceAll(left, placeholder).replaceAll(right, left).replaceAll(placeholder, right);
}

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

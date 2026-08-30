import { constants } from 'node:fs';
import { access, chmod, mkdir, mkdtemp, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import * as ts from 'typescript';

import { ICON_BASE64, ICON_SHA256 } from '../src/generated/icons';

const ARTIFACT_NAME = 'tibo-raccoon.2m.js';
const TEST_STATE_MARKER = '.tibo-raccoon-test-state';
const TEST_STATE_MARKER_CONTENT = 'tibo-raccoon-test-state-v1\n';
const ALLOWED_RUNTIME_IMPORTS = new Set([
  'crypto',
  'fs',
  'fs/promises',
  'os',
  'path',
]);
const metadataFor = (bunPath: string): string => [
  `#!${bunPath}`,
  '// <xbar.title>Tibo Raccoon</xbar.title>',
  '// <xbar.version>v0.1.0</xbar.version>',
  '// <xbar.author>Hojin</xbar.author>',
  "// <xbar.desc>Watch Tibo's public posts from the macOS menu bar.</xbar.desc>",
  '// <xbar.dependencies>bun,swiftbar</xbar.dependencies>',
  '// <swiftbar.runInBash>false</swiftbar.runInBash>',
  '// <swiftbar.hideAbout>true</swiftbar.hideAbout>',
  '// <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>',
  '// <swiftbar.hideLastUpdated>true</swiftbar.hideLastUpdated>',
  '// <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>',
  '// <swiftbar.hideSwiftBar>true</swiftbar.hideSwiftBar>',
  '',
].join('\n');

export type BuildOptions = {
  output: string;
  bunPath: string;
};

export async function buildPlugin(options: BuildOptions): Promise<void> {
  validateOutput(options.output);
  await validateBunPath(options.bunPath);

  const bundled = await bundleMain();
  const source = `${metadataFor(options.bunPath)}${bundled}`;
  await writeArtifact(options.output, source);
  await verifyArtifact(options.output, options.bunPath);
}

async function bundleMain(): Promise<string> {
  try {
    const result = await Bun.build({
      entrypoints: [join(import.meta.dir, '../src/main.ts')],
      target: 'bun',
      format: 'esm',
      minify: true,
      sourcemap: 'none',
    });
    if (!result.success || result.logs.some((log) => log.level === 'error') || result.outputs.length !== 1) {
      throw new Error('build error');
    }
    return await result.outputs[0]!.text();
  } catch {
    throw new Error('Plugin build failed');
  }
}

function validateOutput(output: string): void {
  if (!isAbsolute(output) || basename(output) !== ARTIFACT_NAME) {
    throw new Error('Plugin output must be an absolute tibo-raccoon.2m.js path');
  }
}

async function validateBunPath(bunPath: string): Promise<void> {
  if (!isAbsolute(bunPath) || /\s/.test(bunPath)) {
    throw new Error('Bun path must be an absolute executable path without whitespace');
  }
  try {
    const details = await stat(bunPath);
    if (!details.isFile() || (details.mode & 0o111) === 0) throw new Error('not executable');
    await access(bunPath, constants.X_OK);
  } catch {
    throw new Error('Bun path must be an absolute executable path without whitespace');
  }
}

export function extractRuntimeImportSpecifiers(source: string): string[] {
  const file = ts.createSourceFile('tibo-raccoon-artifact.js', source, ts.ScriptTarget.ESNext, false, ts.ScriptKind.JS);
  const parseDiagnostics = (file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (parseDiagnostics === undefined || parseDiagnostics.length !== 0) throw new Error('Plugin artifact verification failed');
  const specifiers = new Set<string>();
  const addModuleSpecifier = (moduleSpecifier: ts.Expression | undefined): void => {
    if (moduleSpecifier === undefined || !ts.isStringLiteralLike(moduleSpecifier)) {
      throw new Error('Plugin artifact verification failed');
    }
    specifiers.add(moduleSpecifier.text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined) addModuleSpecifier(node.moduleSpecifier);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments.length !== 1) throw new Error('Plugin artifact verification failed');
      addModuleSpecifier(node.arguments[0]);
    } else if (ts.isImportEqualsDeclaration(node)) {
      throw new Error('Plugin artifact verification failed');
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...specifiers].sort();
}

export function assertAllowedRuntimeImports(source: string): void {
  if (extractRuntimeImportSpecifiers(source).some((specifier) => !ALLOWED_RUNTIME_IMPORTS.has(specifier))) {
    throw new Error('Plugin artifact verification failed');
  }
}

async function writeArtifact(output: string, source: string): Promise<void> {
  const temporary = join(dirname(output), `.${ARTIFACT_NAME}.tmp-${crypto.randomUUID()}`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    await mkdir(dirname(output), { recursive: true, mode: 0o755 });
    handle = await open(temporary, 'wx', 0o755);
    await handle.writeFile(source, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporary, 0o755);
    await rename(temporary, output);
    await chmod(output, 0o755);
  } catch {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await Bun.file(temporary).delete().catch(() => undefined);
    throw new Error('Plugin build failed');
  }
}

export async function verifyArtifact(output: string, bunPath: string): Promise<void> {
  const file = Bun.file(output);
  const source = await file.text();
  if (
    !source.startsWith(`#!${bunPath}\n`) ||
    !source.startsWith(metadataFor(bunPath)) ||
    source.includes('sourceMappingURL') ||
    source.includes('assets/icons')
  ) {
    throw new Error('Plugin artifact verification failed');
  }
  assertAllowedRuntimeImports(source);
  for (const state of ['calm', 'unread', 'offline'] as const) {
    for (const appearance of ['light', 'dark'] as const) {
      if (!source.includes(ICON_BASE64[state][appearance])) {
        throw new Error('Plugin artifact verification failed');
      }
    }
  }
  if (((await stat(output)).mode & 0o777) !== 0o755) throw new Error('Plugin artifact verification failed');

  const emitted = new Set<string>();
  for (const state of ['calm', 'unread', 'offline'] as const) {
    const images = await executeArtifactForVerification(output, state);
    for (const appearance of ['light', 'dark'] as const) {
      const encoded = images[appearance];
      emitted.add(encoded);
      const hash = new Bun.CryptoHasher('sha256').update(Buffer.from(encoded, 'base64')).digest('hex');
      if (hash !== ICON_SHA256[state][appearance]) throw new Error('Plugin artifact verification failed');
    }
  }
  if (emitted.size !== 6) throw new Error('Plugin artifact verification failed');
}

async function executeArtifactForVerification(
  output: string,
  iconState: 'calm' | 'unread' | 'offline',
): Promise<{ light: string; dark: string }> {
  const executionRoot = await mkdtemp(join(tmpdir(), 'tibo-raccoon-build-verify-'));
  const home = join(executionRoot, 'home');
  const childTmp = join(executionRoot, 'tmp');
  const fallbackDirectory = join(home, 'Library', 'Application Support', 'Tibo Raccoon');
  try {
    await mkdir(home, { mode: 0o700 });
    await mkdir(childTmp, { mode: 0o700 });
    await mkdir(fallbackDirectory, { recursive: true, mode: 0o700 });
    const stateDirectory = await mkdtemp(join(childTmp, 'tibo-raccoon-state-'));
    const stateBody = `${JSON.stringify(canonicalVerificationState(iconState))}\n`;
    await writeFile(join(stateDirectory, TEST_STATE_MARKER), TEST_STATE_MARKER_CONTENT, { mode: 0o600 });
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
    if (exitCode !== 0 || stderr !== '') throw new Error('Plugin artifact verification failed');
    const header = stdout.split('\n', 1)[0] ?? '';
    const match = /^\| image=([^,\s]+),([^\s]+) dropdown=false$/.exec(header);
    if (match === null || match[1] === undefined || match[2] === undefined) {
      throw new Error('Plugin artifact verification failed');
    }
    return { light: match[1], dark: match[2] };
  } catch {
    throw new Error('Plugin artifact verification failed');
  } finally {
    await rm(executionRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

function canonicalVerificationState(iconState: 'calm' | 'unread' | 'offline'): object {
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
    lastAttemptAt: '9999-12-31T23:59:58.000Z',
    lastSuccessAt: '2026-08-30T00:00:00.000Z',
    consecutiveFailures: iconState === 'offline' ? 3 : 0,
    nextRetryAt: '9999-12-31T23:59:59.999Z',
    lastError: iconState === 'offline' ? 'network' : null,
  };
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
    if (!killed) throw new Error('Plugin artifact verification failed');
    throw new Error('Plugin artifact verification failed');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

if (import.meta.main) {
  const output = join(import.meta.dir, '../dist', ARTIFACT_NAME);
  buildPlugin({ output, bunPath: process.execPath }).catch(() => {
    process.stderr.write('Plugin build failed\n');
    process.exitCode = 1;
  });
}

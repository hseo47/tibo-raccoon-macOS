import { chmod, mkdir, open, rename, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';

import { ICON_BASE64, ICON_SHA256 } from '../src/generated/icons';

const ARTIFACT_NAME = 'tibo-raccoon.2m.js';
const metadataFor = (bunPath: string): string => [
  `#!${bunPath}`,
  '// <xbar.title>Tibo Raccoon</xbar.title>',
  '// <xbar.version>v0.1.0</xbar.version>',
  '// <xbar.author>Hojin</xbar.author>',
  "// <xbar.desc>Watch Tibo's public posts from the macOS menu bar.</xbar.desc>",
  '// <xbar.dependencies>bun,swiftbar</xbar.dependencies>',
  '// <swiftbar.runInBash>false</swiftbar.runInBash>',
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
  const source = `${metadataFor(options.bunPath)}${integrityComment()}${bundled}`;
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
  } catch {
    throw new Error('Bun path must be an absolute executable path without whitespace');
  }
}

function integrityComment(): string {
  const entries: string[] = [];
  for (const state of ['calm', 'unread', 'offline'] as const) {
    for (const appearance of ['light', 'dark'] as const) {
      entries.push(`${state}.${appearance} sha256=${ICON_SHA256[state][appearance]} base64=${ICON_BASE64[state][appearance]}`);
    }
  }
  return `// tibo-raccoon-icon-integrity ${entries.join(' | ')}\n`;
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

async function verifyArtifact(output: string, bunPath: string): Promise<void> {
  const file = Bun.file(output);
  const source = await file.text();
  if (
    !source.startsWith(`#!${bunPath}\n`) ||
    !source.startsWith(metadataFor(bunPath)) ||
    source.includes('sourceMappingURL') ||
    source.includes('assets/icons') ||
    source.match(/(?:from\s*|import\s*\()['\"](?:\.{1,2}\/|src\/|assets\/|tibo-raccoon-swiftbar)/) !== null
  ) {
    throw new Error('Plugin artifact verification failed');
  }
  for (const state of ['calm', 'unread', 'offline'] as const) {
    for (const appearance of ['light', 'dark'] as const) {
      if (!source.includes(ICON_BASE64[state][appearance]) || !source.includes(ICON_SHA256[state][appearance])) {
        throw new Error('Plugin artifact verification failed');
      }
    }
  }
  if (((await stat(output)).mode & 0o777) !== 0o755) throw new Error('Plugin artifact verification failed');
}

if (import.meta.main) {
  const output = join(import.meta.dir, '../dist', ARTIFACT_NAME);
  buildPlugin({ output, bunPath: process.execPath }).catch(() => {
    process.stderr.write('Plugin build failed\n');
    process.exitCode = 1;
  });
}

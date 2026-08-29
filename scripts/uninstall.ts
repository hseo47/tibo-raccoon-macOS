import { lstat, unlink } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';

import { hasUnsafeControl, printableOneLine } from './cli-output';

const ARTIFACT_NAME = 'tibo-raccoon.2m.js';
const RETAINED_STATE_PATH = '~/Library/Application Support/Tibo Raccoon/';

export type UninstallDependencies = {
  lstat(path: string): Promise<{ isFile(): boolean; isSymbolicLink(): boolean }>;
  unlink(path: string): Promise<void>;
};

export async function uninstallPlugin(options: {
  pluginPath: string;
  confirmed: boolean;
  dependencies?: UninstallDependencies;
}): Promise<{ removedPath: string; retainedStatePath: string }> {
  if (!isAbsolute(options.pluginPath) || hasUnsafeControl(options.pluginPath)) {
    throw new Error('Plugin path must be a safe absolute path');
  }
  if (basename(options.pluginPath) !== ARTIFACT_NAME) {
    throw new Error(`Plugin path must be an absolute ${ARTIFACT_NAME} path`);
  }
  if (!options.confirmed) throw new Error('Plugin removal requires explicit confirmation');

  const dependencies = options.dependencies ?? { lstat, unlink };
  let details: { isFile(): boolean; isSymbolicLink(): boolean };
  try {
    details = await dependencies.lstat(options.pluginPath);
  } catch {
    throw new Error('Plugin artifact is not installed');
  }
  if (!details.isFile() || details.isSymbolicLink()) throw new Error('Plugin target must be a regular file');
  try {
    await dependencies.unlink(options.pluginPath);
  } catch {
    throw new Error('Plugin artifact could not be removed');
  }
  return { removedPath: options.pluginPath, retainedStatePath: RETAINED_STATE_PATH };
}

type Writable = { write(value: string): unknown };

export type UninstallCliIo = {
  uninstall?: typeof uninstallPlugin;
  stdout: Writable;
  stderr: Writable;
  process: { exitCode: number | string | null | undefined };
};

export async function runUninstallCli(argv: readonly string[], io: UninstallCliIo): Promise<void> {
  const parsed = readPluginPathArgument(argv);
  if (parsed === null) {
    io.stderr.write('Usage: bun run uninstall:plugin -- --plugin-path "/absolute/tibo-raccoon.2m.js" --yes\n');
    io.process.exitCode = 64;
    return;
  }
  try {
    const result = await (io.uninstall ?? uninstallPlugin)(parsed);
    io.stdout.write(`Removed: ${printableOneLine(result.removedPath)}\nState retained: ${printableOneLine(result.retainedStatePath)}\n`);
    io.process.exitCode = 0;
  } catch (error) {
    io.stderr.write(`${printableOneLine(error instanceof Error ? error.message : 'Plugin removal failed')}\n`);
    io.process.exitCode = 1;
  }
}

function readPluginPathArgument(argv: readonly string[]): { pluginPath: string; confirmed: boolean } | null {
  if (argv.length === 3 && argv[0] === '--plugin-path' && argv[2] === '--yes') {
    return { pluginPath: argv[1] ?? '', confirmed: true };
  }
  return null;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  await runUninstallCli(argv, { stdout: process.stdout, stderr: process.stderr, process });
}

if (import.meta.main) {
  void main();
}

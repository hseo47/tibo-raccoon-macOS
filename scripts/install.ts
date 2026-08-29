import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, copyFile, lstat, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';

import { buildPlugin } from './build';
import { hasUnsafeControl, printableOneLine } from './cli-output';

const ARTIFACT_NAME = 'tibo-raccoon.2m.js';
const execFileAsync = promisify(execFile);

export type InstallDependencies = {
  platform: string;
  locateSwiftBar(): Promise<boolean>;
  isExecutable(path: string): Promise<boolean>;
  build: typeof buildPlugin;
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  makeTempDirectory(): Promise<string>;
  copyFile(source: string, destination: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  removeTempDirectory(path: string): Promise<void>;
};

export async function installPlugin(options: {
  pluginDirectory: string;
  bunPath: string;
  dependencies?: InstallDependencies;
}): Promise<{ installedPath: string }> {
  const dependencies = options.dependencies ?? productionDependencies();
  validateInstallInputs(options, dependencies);
  await validatePrerequisites(options, dependencies);

  const temporaryDirectory = await dependencies.makeTempDirectory();
  if (!isAbsolute(temporaryDirectory)) throw new Error('Plugin installation failed');
  const builtArtifact = join(temporaryDirectory, ARTIFACT_NAME);
  const installedPath = join(options.pluginDirectory, ARTIFACT_NAME);
  const stagedArtifact = join(options.pluginDirectory, `.${ARTIFACT_NAME}.install-${crypto.randomUUID()}`);
  let renamed = false;
  let stageOwned = false;
  try {
    await dependencies.build({ output: builtArtifact, bunPath: options.bunPath });
    await dependencies.copyFile(builtArtifact, stagedArtifact);
    stageOwned = true;
    await dependencies.chmod(stagedArtifact, 0o755);
    await dependencies.rename(stagedArtifact, installedPath);
    renamed = true;
    return { installedPath };
  } catch {
    throw new Error('Plugin installation failed');
  } finally {
    if (stageOwned && !renamed) await dependencies.removeTempDirectory(stagedArtifact).catch(() => undefined);
    await dependencies.removeTempDirectory(temporaryDirectory).catch(() => undefined);
  }
}

function validateInstallInputs(options: { pluginDirectory: string; bunPath: string }, dependencies: InstallDependencies): void {
  if (dependencies.platform !== 'darwin') throw new Error('Plugin installation requires macOS');
  if (!isAbsolute(options.pluginDirectory) || hasUnsafeControl(options.pluginDirectory)) {
    throw new Error('SwiftBar plugin directory must be a safe absolute directory');
  }
  if (!isAbsolute(options.bunPath) || /\s/.test(options.bunPath)) {
    throw new Error('Bun path must be an absolute executable path without whitespace');
  }
}

async function validatePrerequisites(options: { pluginDirectory: string; bunPath: string }, dependencies: InstallDependencies): Promise<void> {
  if (!(await dependencies.locateSwiftBar())) throw new Error('SwiftBar is not installed');
  if (!(await dependencies.isExecutable(options.bunPath))) {
    throw new Error('Bun path must be an absolute executable path without whitespace');
  }
  try {
    if (!(await dependencies.stat(options.pluginDirectory)).isDirectory()) {
      throw new Error('not a directory');
    }
  } catch {
    throw new Error('SwiftBar plugin directory must be an existing directory');
  }
}

function productionDependencies(): InstallDependencies {
  return {
    platform: process.platform,
    locateSwiftBar,
    isExecutable: isCurrentUserExecutableFile,
    build: buildPlugin,
    stat,
    makeTempDirectory: () => mkdtemp(join(tmpdir(), 'tibo-raccoon-build-')),
    copyFile: copyArtifactExclusively,
    chmod,
    rename,
    removeTempDirectory: (path) => rm(path, { recursive: true, force: true }),
  };
}

async function locateSwiftBar(): Promise<boolean> {
  try {
    const result = await execFileAsync('mdfind', ["kMDItemCFBundleIdentifier == 'com.ameba.SwiftBar'"], { encoding: 'utf8' });
    return result.stdout.trim() !== '';
  } catch {
    return false;
  }
}

export async function isCurrentUserExecutableFile(path: string): Promise<boolean> {
  try {
    const details = await lstat(path);
    if (!details.isFile() || (details.mode & 0o100) === 0) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function copyArtifactExclusively(source: string, destination: string): Promise<void> {
  await copyFile(source, destination, constants.COPYFILE_EXCL);
}

type Writable = { write(value: string): unknown };

export type InstallCliIo = {
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  prompt?: () => Promise<string>;
  install?: typeof installPlugin;
  bunPath?: string;
  stdout: Writable;
  stderr: Writable;
  process: { exitCode: number | string | null | undefined };
};

export async function runInstallCli(argv: readonly string[], io: InstallCliIo): Promise<void> {
  const explicitPluginDirectory = readPluginDirectoryArgument(argv);
  let pluginDirectory: string | null = explicitPluginDirectory;
  if (pluginDirectory === null && argv.length === 0 && io.stdinIsTTY && io.stdoutIsTTY) {
    pluginDirectory = await (io.prompt ?? promptForPluginDirectory)();
  }
  if (
    pluginDirectory === null ||
    pluginDirectory.trim() === '' ||
    !isAbsolute(pluginDirectory) ||
    hasUnsafeControl(pluginDirectory)
  ) {
    writeUsage(io);
    return;
  }
  try {
    const result = await (io.install ?? installPlugin)({ pluginDirectory, bunPath: io.bunPath ?? process.execPath });
    io.stdout.write(`Installed: ${printableOneLine(result.installedPath)}\nIn SwiftBar, choose Refresh All.\n`);
    io.process.exitCode = 0;
  } catch (error) {
    io.stderr.write(`${printableOneLine(error instanceof Error ? error.message : 'Plugin installation failed')}\n`);
    io.process.exitCode = 1;
  }
}

function readPluginDirectoryArgument(argv: readonly string[]): string | null {
  if (argv.length === 2 && argv[0] === '--plugin-dir') return argv[1] ?? null;
  return null;
}

function writeUsage(io: InstallCliIo): void {
  io.stderr.write('Usage: bun run install:plugin -- --plugin-dir "/absolute/SwiftBar plugins"\n');
  io.process.exitCode = 64;
}

async function promptForPluginDirectory(): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await prompt.question('SwiftBar plugin directory: ');
  } finally {
    prompt.close();
  }
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  await runInstallCli(argv, {
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
    stdout: process.stdout,
    stderr: process.stderr,
    process,
  });
}

if (import.meta.main) {
  void main();
}

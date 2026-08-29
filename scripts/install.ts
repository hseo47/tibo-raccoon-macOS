import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, copyFile, lstat, mkdtemp, rename, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

import { buildPlugin } from './build';

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
  try {
    await dependencies.build({ output: builtArtifact, bunPath: options.bunPath });
    await dependencies.copyFile(builtArtifact, stagedArtifact);
    await dependencies.chmod(stagedArtifact, 0o755);
    await dependencies.rename(stagedArtifact, installedPath);
    renamed = true;
    return { installedPath };
  } catch {
    throw new Error('Plugin installation failed');
  } finally {
    if (!renamed) await unlink(stagedArtifact).catch(() => undefined);
    await dependencies.removeTempDirectory(temporaryDirectory).catch(() => undefined);
  }
}

function validateInstallInputs(options: { pluginDirectory: string; bunPath: string }, dependencies: InstallDependencies): void {
  if (dependencies.platform !== 'darwin') throw new Error('Plugin installation requires macOS');
  if (!isAbsolute(options.pluginDirectory)) throw new Error('SwiftBar plugin directory must be an absolute directory');
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
    copyFile,
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

async function isCurrentUserExecutableFile(path: string): Promise<boolean> {
  try {
    const details = await lstat(path);
    if (!details.isFile() || (details.mode & 0o100) === 0) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readPluginDirectoryArgument(argv: readonly string[]): string | null {
  if (argv.length === 2 && argv[0] === '--plugin-dir') return argv[1] ?? null;
  return null;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const pluginDirectory = readPluginDirectoryArgument(argv);
  if (pluginDirectory === null) {
    process.stderr.write('Usage: bun run install:plugin -- --plugin-dir "/absolute/SwiftBar plugins"\n');
    process.exitCode = 64;
    return;
  }
  try {
    const result = await installPlugin({ pluginDirectory, bunPath: process.execPath });
    process.stdout.write(`Installed: ${result.installedPath}\nIn SwiftBar, choose Refresh All.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Plugin installation failed'}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  void main();
}

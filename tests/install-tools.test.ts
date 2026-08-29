import { afterEach, expect, test } from 'bun:test';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { copyArtifactExclusively, isCurrentUserExecutableFile, type InstallDependencies, installPlugin, runInstallCli } from '../scripts/install';
import { type UninstallDependencies, runUninstallCli, uninstallPlugin } from '../scripts/uninstall';
import { buildPlugin } from '../scripts/build';

type InstallHarness = {
  pluginDirectory: string;
  stateFile: string;
  bunPath: string;
  dependencies: InstallDependencies;
};

type RecordedOperation = { operation: string; paths: string[] };

const harnessRoots: string[] = [];

test('install copies only the built artifact and preserves state', async () => {
  const harness = await installHarness();
  const before = await Bun.file(harness.stateFile).text();
  const result = await installPlugin({
    pluginDirectory: harness.pluginDirectory,
    bunPath: harness.bunPath,
    dependencies: harness.dependencies,
  });

  expect(result.installedPath).toBe(join(harness.pluginDirectory, 'tibo-raccoon.2m.js'));
  expect(await Bun.file(result.installedPath).text()).toBe('#!/fake/bun\nartifact\n');
  expect((await stat(result.installedPath)).mode & 0o777).toBe(0o755);
  expect(await Bun.file(harness.stateFile).text()).toBe(before);
  await assertHarnessOperationsStayInRoot(harness);
  expect((await readdir(harness.pluginDirectory)).sort()).toEqual(['tibo-raccoon.2m.js']);
});

test('install replaces exactly the prior artifact without mutating state', async () => {
  const harness = await installHarness();
  const target = join(harness.pluginDirectory, 'tibo-raccoon.2m.js');
  await writeFile(target, 'old artifact\n', { mode: 0o755 });
  const before = await Bun.file(harness.stateFile).text();

  await installPlugin({ pluginDirectory: harness.pluginDirectory, bunPath: harness.bunPath, dependencies: harness.dependencies });

  expect(await Bun.file(target).text()).toBe('#!/fake/bun\nartifact\n');
  expect(await Bun.file(harness.stateFile).text()).toBe(before);
  await assertHarnessOperationsStayInRoot(harness);
  expect((await readdir(harness.pluginDirectory)).sort()).toEqual(['tibo-raccoon.2m.js']);
});

test('install accepts an absolute plugin directory containing spaces', async () => {
  const harness = await installHarness({ pluginDirectoryName: 'SwiftBar Plugins' });
  await installPlugin({ pluginDirectory: harness.pluginDirectory, bunPath: harness.bunPath, dependencies: harness.dependencies });
  expect(await Bun.file(join(harness.pluginDirectory, 'tibo-raccoon.2m.js')).exists()).toBe(true);
  await assertHarnessOperationsStayInRoot(harness);
});

test('install rejects unavailable prerequisites and unsafe paths before copying', async () => {
  const harness = await installHarness();
  const cases: Array<{ options: Partial<Parameters<typeof installPlugin>[0]>; dependencies?: Partial<InstallDependencies>; message: string }> = [
    { options: {}, dependencies: { platform: 'linux' }, message: 'macOS' },
    { options: {}, dependencies: { locateSwiftBar: async () => false }, message: 'SwiftBar' },
    { options: { bunPath: 'relative/bun' }, message: 'Bun path' },
    { options: { bunPath: '/tmp/bun path' }, message: 'Bun path' },
    { options: {}, dependencies: { isExecutable: async () => false }, message: 'Bun path' },
    { options: { pluginDirectory: 'relative/plugins' }, message: 'plugin directory' },
    { options: { pluginDirectory: join(harness.pluginDirectory, 'missing') }, message: 'plugin directory' },
  ];

  for (const item of cases) {
    const dependencies = { ...harness.dependencies, ...item.dependencies };
    await expect(installPlugin({
      pluginDirectory: item.options.pluginDirectory ?? harness.pluginDirectory,
      bunPath: item.options.bunPath ?? harness.bunPath,
      dependencies,
    })).rejects.toThrow(item.message);
  }
  expect(await readdir(harness.pluginDirectory)).toEqual([]);
  await assertHarnessOperationsStayInRoot(harness);
});

test('install cleans build and staging temporaries after a replacement failure', async () => {
  const harness = await installHarness({ rename: async () => { throw new Error('rename failed'); } });
  await expect(installPlugin({ pluginDirectory: harness.pluginDirectory, bunPath: harness.bunPath, dependencies: harness.dependencies })).rejects.toThrow('Plugin installation failed');
  expect(await readdir(harness.pluginDirectory)).toEqual([]);
  await assertHarnessOperationsStayInRoot(harness);
});

test('install keeps regular and symlink staging collisions unchanged before exclusive copy', async () => {
  const regular = await installHarness();
  let regularCollision = '';
  regular.dependencies.copyFile = async (source, destination) => {
    recordHarnessOperation(regular, 'copyFile', source, destination);
    regularCollision = destination;
    await writeFile(destination, 'regular collision');
    await copyArtifactExclusively(source, destination);
  };
  await expect(installPlugin({ pluginDirectory: regular.pluginDirectory, bunPath: regular.bunPath, dependencies: regular.dependencies })).rejects.toThrow('Plugin installation failed');
  expect(await Bun.file(regularCollision).text()).toBe('regular collision');
  await assertHarnessOperationsStayInRoot(regular);

  const linked = await installHarness();
  const siblingRoot = harnessSibling(linked);
  const sentinel = join(siblingRoot, 'sentinel');
  let symlinkCollision = '';
  await mkdir(siblingRoot);
  await writeFile(sentinel, 'preserve sentinel');
  linked.dependencies.copyFile = async (source, destination) => {
    recordHarnessOperation(linked, 'copyFile', source, destination);
    symlinkCollision = destination;
    await symlink(sentinel, destination);
    await copyArtifactExclusively(source, destination);
  };
  await expect(installPlugin({ pluginDirectory: linked.pluginDirectory, bunPath: linked.bunPath, dependencies: linked.dependencies })).rejects.toThrow('Plugin installation failed');
  expect((await lstat(symlinkCollision)).isSymbolicLink()).toBe(true);
  expect(await Bun.file(sentinel).text()).toBe('preserve sentinel');
  await assertHarnessOperationsStayInRoot(linked);
});

test('install removes an owned partial same-directory stage after a copy failure', async () => {
  const harness = await installHarness();
  let partialStage = '';
  harness.dependencies.copyFile = async (source, destination) => {
    recordHarnessOperation(harness, 'copyFile', source, destination);
    partialStage = destination;
    await copyFile(source, destination);
    throw new Error('partial copy failure');
  };
  await expect(installPlugin({ pluginDirectory: harness.pluginDirectory, bunPath: harness.bunPath, dependencies: harness.dependencies })).rejects.toThrow('Plugin installation failed');
  expect(await Bun.file(partialStage).exists()).toBe(false);
  expect(harnessOperations(harness).some(({ operation, paths }) => operation === 'removeTempDirectory' && paths[0] === partialStage)).toBe(true);
  await assertHarnessOperationsStayInRoot(harness);
});

test('install records only contained cleanup and preserves an adjacent sentinel after each failure boundary', async () => {
  for (const failure of ['build', 'copy', 'chmod', 'rename'] as const) {
    const harness = await installHarness({ failure });
    const siblingRoot = harnessSibling(harness);
    const sentinel = join(siblingRoot, 'sentinel');
    await mkdir(siblingRoot);
    await writeFile(sentinel, `preserve ${failure}`);
    await expect(installPlugin({ pluginDirectory: harness.pluginDirectory, bunPath: harness.bunPath, dependencies: harness.dependencies })).rejects.toThrow('Plugin installation failed');
    expect(await Bun.file(sentinel).text()).toBe(`preserve ${failure}`);
    expect(await readdir(harness.pluginDirectory)).toEqual([]);
    await assertHarnessOperationsStayInRoot(harness);
    expect(harnessOperations(harness).some(({ operation }) => operation === 'removeTempDirectory')).toBe(true);
  }
});

test('production executable validation rejects nonregular and non-current-user-executable paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tibo-raccoon-install-validation-'));
  harnessRoots.push(root);
  const directory = join(root, 'directory');
  const regular = join(root, 'regular');
  await mkdir(directory);
  await writeFile(regular, '#!/bin/sh\n', { mode: 0o600 });
  expect(await isCurrentUserExecutableFile(directory)).toBe(false);
  expect(await isCurrentUserExecutableFile(regular)).toBe(false);
});

test('install rejects an existing regular file as the plugin directory without SwiftBar discovery', async () => {
  const harness = await installHarness();
  const regularDirectory = join(harnessRoot(harness), 'not-a-directory');
  await writeFile(regularDirectory, 'file');
  await expect(installPlugin({
    pluginDirectory: regularDirectory,
    bunPath: harness.bunPath,
    dependencies: harness.dependencies,
  })).rejects.toThrow('existing directory');
});

test('install and uninstall reject control characters in paths without touching files', async () => {
  const harness = await installHarness();
  for (const control of ['\n', '\u0001', '\u0085', '\u2028', '\u2029']) {
    await expect(installPlugin({
      pluginDirectory: `${harness.pluginDirectory}${control}`,
      bunPath: harness.bunPath,
      dependencies: harness.dependencies,
    })).rejects.toThrow('safe absolute directory');
    await expect(uninstallPlugin({
      pluginPath: `${harness.pluginDirectory}${control}/tibo-raccoon.2m.js`,
      confirmed: true,
      dependencies: { lstat, unlink },
    })).rejects.toThrow('safe absolute');
  }
  expect(await readdir(harness.pluginDirectory)).toEqual([]);
});

test('install CLI uses explicit arguments, prompts only on both TTYs, and rejects empty or non-TTY input', async () => {
  const calls: string[] = [];
  const writer = cliWriter();
  const install = (async ({ pluginDirectory }: Parameters<typeof installPlugin>[0]) => {
    calls.push(pluginDirectory);
    return { installedPath: pluginDirectory };
  }) as typeof installPlugin;
  await runInstallCli(['--plugin-dir', '/tmp/explicit'], { ...writer.io, install, bunPath: '/tmp/bun', stdinIsTTY: true, stdoutIsTTY: true, prompt: async () => { throw new Error('unexpected prompt'); } });
  expect(calls).toEqual(['/tmp/explicit']);
  expect(writer.stdout).toBe('Installed: /tmp/explicit\nIn SwiftBar, choose Refresh All.\n');

  const interactive = cliWriter();
  await runInstallCli([], { ...interactive.io, install, bunPath: '/tmp/bun', stdinIsTTY: true, stdoutIsTTY: true, prompt: async () => '/tmp/interactive' });
  expect(calls).toEqual(['/tmp/explicit', '/tmp/interactive']);

  const empty = cliWriter();
  await runInstallCli([], { ...empty.io, install, bunPath: '/tmp/bun', stdinIsTTY: true, stdoutIsTTY: true, prompt: async () => '   ' });
  expect(empty.stderr).toBe('Usage: bun run install:plugin -- --plugin-dir "/absolute/SwiftBar plugins"\n');
  expect(empty.io.process.exitCode).toBe(64);

  const invalid = cliWriter();
  await runInstallCli([], { ...invalid.io, install, bunPath: '/tmp/bun', stdinIsTTY: true, stdoutIsTTY: true, prompt: async () => 'relative/plugins' });
  expect(invalid.stderr).toBe('Usage: bun run install:plugin -- --plugin-dir "/absolute/SwiftBar plugins"\n');
  expect(invalid.io.process.exitCode).toBe(64);
  expect(calls).toEqual(['/tmp/explicit', '/tmp/interactive']);

  const nonTty = cliWriter();
  await runInstallCli([], { ...nonTty.io, install, bunPath: '/tmp/bun', stdinIsTTY: false, stdoutIsTTY: true, prompt: async () => { throw new Error('must not prompt'); } });
  expect(nonTty.stderr).toBe('Usage: bun run install:plugin -- --plugin-dir "/absolute/SwiftBar plugins"\n');
  expect(nonTty.io.process.exitCode).toBe(64);

  const outputNotTty = cliWriter();
  await runInstallCli([], { ...outputNotTty.io, install, bunPath: '/tmp/bun', stdinIsTTY: true, stdoutIsTTY: false, prompt: async () => { throw new Error('must not prompt'); } });
  expect(outputNotTty.stderr).toBe('Usage: bun run install:plugin -- --plugin-dir "/absolute/SwiftBar plugins"\n');
  expect(outputNotTty.io.process.exitCode).toBe(64);
});

test('install CLI contains a rejecting TTY prompt without raw diagnostics', async () => {
  const writer = cliWriter();
  await runInstallCli([], {
    ...writer.io,
    install: (async () => { throw new Error('installer must not run'); }) as typeof installPlugin,
    bunPath: '/tmp/bun', stdinIsTTY: true, stdoutIsTTY: true,
    prompt: async () => { throw new Error('prompt failed\n\u001b[2J'); },
  });
  expect(writer.stdout).toBe('');
  expect(writer.stderr).toBe('Plugin directory prompt failed\n');
  expect(writer.io.process.exitCode).toBe(1);
});

test('CLI output escapes dynamic paths and newest IDs into one printable line', async () => {
  const installWriter = cliWriter();
  const unsafe = '/tmp/installed\n\u001b[2J\u0085';
  await runInstallCli(['--plugin-dir', '/tmp/safe'], {
    ...installWriter.io,
    install: (async () => ({ installedPath: unsafe })) as typeof installPlugin,
    bunPath: '/tmp/bun', stdinIsTTY: false, stdoutIsTTY: false,
  });
  expect(installWriter.stdout).toBe('Installed: /tmp/installed\\n\\u001b[2J\\u0085\nIn SwiftBar, choose Refresh All.\n');

  const uninstallWriter = cliWriter();
  await runUninstallCli(['--plugin-path', '/tmp/tibo-raccoon.2m.js', '--yes'], {
    ...uninstallWriter.io,
    uninstall: (async () => ({ removedPath: '/tmp/removed\u2028', retainedStatePath: 'state\u0001' })) as typeof uninstallPlugin,
  });
  expect(uninstallWriter.stdout).toBe('Removed: /tmp/removed\\u2028\nState retained: state\\u0001\n');

  const failureWriter = cliWriter();
  await runInstallCli(['--plugin-dir', '/tmp/safe'], {
    ...failureWriter.io,
    install: (async () => { throw new Error('failed\n\u001b[2J'); }) as typeof installPlugin,
    bunPath: '/tmp/bun', stdinIsTTY: false, stdoutIsTTY: false,
  });
  expect(failureWriter.stdout).toBe('');
  expect(failureWriter.stderr).toBe('failed\\n\\u001b[2J\n');
});

test('uninstall removes only the exact regular artifact and retains state', async () => {
  const harness = await installHarness();
  const target = join(harness.pluginDirectory, 'tibo-raccoon.2m.js');
  const sibling = join(harness.pluginDirectory, 'keep.js');
  await writeFile(target, 'artifact');
  await writeFile(sibling, 'keep');
  const before = await Bun.file(harness.stateFile).text();
  const operations: string[] = [];
  const dependencies: UninstallDependencies = {
    lstat: async (path) => { operations.push(path); return lstat(path); },
    unlink: async (path) => { operations.push(path); await unlink(path); },
  };

  const result = await uninstallPlugin({ pluginPath: target, confirmed: true, dependencies });

  expect(result).toEqual({ removedPath: target, retainedStatePath: '~/Library/Application Support/Tibo Raccoon/' });
  expect(await Bun.file(target).exists()).toBe(false);
  expect(await Bun.file(sibling).text()).toBe('keep');
  expect(await Bun.file(harness.stateFile).text()).toBe(before);
  expect(operations).toEqual([target, target]);
  expect(operations.every((path) => isContainedBy(harnessRoot(harness), path))).toBe(true);
});

test('uninstall rejects unconfirmed, wrong, missing, symlink, and nonregular targets without unlinking', async () => {
  const harness = await installHarness();
  const target = join(harness.pluginDirectory, 'tibo-raccoon.2m.js');
  const directoryTarget = join(harness.pluginDirectory, 'directory', 'tibo-raccoon.2m.js');
  const linkTarget = join(harness.pluginDirectory, 'link', 'tibo-raccoon.2m.js');
  await mkdir(directoryTarget, { recursive: true });
  await mkdir(join(harness.pluginDirectory, 'link'), { recursive: true });
  await writeFile(target, 'artifact');
  await symlink(target, linkTarget);
  const unlinks: string[] = [];
  const dependencies: UninstallDependencies = {
    lstat,
    unlink: async (path) => { unlinks.push(path); await unlink(path); },
  };

  await expect(uninstallPlugin({ pluginPath: target, confirmed: false, dependencies })).rejects.toThrow('confirmation');
  await expect(uninstallPlugin({ pluginPath: join(harness.pluginDirectory, 'other.2m.js'), confirmed: true, dependencies })).rejects.toThrow('tibo-raccoon.2m.js');
  await expect(uninstallPlugin({ pluginPath: join(harness.pluginDirectory, 'missing', 'tibo-raccoon.2m.js'), confirmed: true, dependencies })).rejects.toThrow('not installed');
  await expect(uninstallPlugin({ pluginPath: directoryTarget, confirmed: true, dependencies })).rejects.toThrow('regular file');
  await expect(uninstallPlugin({ pluginPath: linkTarget, confirmed: true, dependencies })).rejects.toThrow('regular file');
  expect(unlinks).toEqual([]);
  expect(await Bun.file(target).text()).toBe('artifact');
});

test('fresh child imports are fetch-fail-closed and do not add files to their actual runtime trees', async () => {
  const childRoot = await mkdtemp(join(tmpdir(), 'tibo-raccoon-import-child-'));
  harnessRoots.push(childRoot);
  const childHome = join(childRoot, 'home');
  const childTmp = join(childRoot, 'tmp');
  const childCache = join(childRoot, 'cache');
  await Promise.all([mkdir(childHome), mkdir(childTmp), mkdir(childCache)]);
  const environment = { HOME: childHome, TMPDIR: childTmp, BUN_INSTALL_CACHE_DIR: childCache };
  const modulePaths = ['../scripts/install.ts', '../scripts/uninstall.ts', '../scripts/live-check.ts'];
  for (const modulePath of modulePaths) await runFreshGuardedImport(modulePath, environment);
  const baseline = await snapshotRuntimeTrees(childHome, childTmp, childCache);
  for (const modulePath of modulePaths) {
    await runFreshGuardedImport(modulePath, environment);
    expect(await snapshotRuntimeTrees(childHome, childTmp, childCache)).toEqual(baseline);
  }
});

async function installHarness(options: {
  pluginDirectoryName?: string;
  rename?: InstallDependencies['rename'];
  failure?: 'build' | 'copy' | 'chmod' | 'rename';
} = {}): Promise<InstallHarness> {
  const parent = await mkdtemp(join(tmpdir(), 'tibo-raccoon-install-parent-'));
  const root = join(parent, 'harness');
  harnessRoots.push(parent);
  const pluginDirectory = join(root, options.pluginDirectoryName ?? 'plugins');
  const stateDirectory = join(root, 'state');
  const stateFile = join(stateDirectory, 'state.json');
  const bunPath = join(root, 'bun');
  const operations: RecordedOperation[] = [];
  await mkdir(pluginDirectory, { recursive: true });
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(stateFile, '{"preserve":true}\n', { mode: 0o600 });
  await writeFile(bunPath, '#!/bin/sh\n', { mode: 0o700 });
  const record = (operation: string, ...paths: string[]) => { operations.push({ operation, paths }); };
  const dependencies: InstallDependencies = {
    platform: 'darwin',
    locateSwiftBar: async () => true,
    isExecutable: async (path) => { record('isExecutable', path); return path === bunPath; },
    build: (async ({ output }: Parameters<typeof buildPlugin>[0]) => {
      record('build', output);
      if (options.failure === 'build') throw new Error('build failure');
      await writeFile(output, '#!/fake/bun\nartifact\n', { mode: 0o755 });
    }) as typeof buildPlugin,
    stat: async (path) => { record('stat', path); return stat(path); },
    makeTempDirectory: async () => {
      const directory = await mkdtemp(join(root, 'build-'));
      record('makeTempDirectory', directory);
      return directory;
    },
    copyFile: async (source, destination) => { record('copyFile', source, destination); if (options.failure === 'copy') throw new Error('copy failure'); await copyFile(source, destination); },
    chmod: async (path, mode) => { record('chmod', path); if (options.failure === 'chmod') throw new Error('chmod failure'); await chmod(path, mode); },
    rename: options.rename ?? (async (source, destination) => { record('rename', source, destination); if (options.failure === 'rename') throw new Error('rename failure'); await rename(source, destination); }),
    removeTempDirectory: async (path) => { record('removeTempDirectory', path); await rm(path, { recursive: true, force: true }); },
  };
  Object.defineProperty(dependencies, '__root', { value: root });
  Object.defineProperty(dependencies, '__operations', { value: operations });
  return { pluginDirectory, stateFile, bunPath, dependencies };
}

function harnessRoot(harness: InstallHarness): string {
  return (harness.dependencies as InstallDependencies & { __root: string }).__root;
}

function harnessSibling(harness: InstallHarness): string {
  return join(dirname(harnessRoot(harness)), 'sentinel-sibling');
}

async function assertHarnessOperationsStayInRoot(harness: InstallHarness): Promise<void> {
  const { __root: root, __operations: operations } = harness.dependencies as InstallDependencies & { __root: string; __operations: RecordedOperation[] };
  expect(root.startsWith(tmpdir())).toBe(true);
  expect(operations.length).toBeGreaterThan(0);
  expect(operations.flatMap(({ paths }) => paths).every((path) => isAbsolute(path) && isContainedBy(root, path))).toBe(true);
}

function isContainedBy(root: string, path: string): boolean {
  const pathRelative = relative(root, path);
  return pathRelative === '' || (!pathRelative.startsWith('..') && !isAbsolute(pathRelative));
}

function harnessOperations(harness: InstallHarness): RecordedOperation[] {
  return (harness.dependencies as InstallDependencies & { __operations: RecordedOperation[] }).__operations;
}

function recordHarnessOperation(harness: InstallHarness, operation: string, ...paths: string[]): void {
  harnessOperations(harness).push({ operation, paths });
}

function cliWriter(): { stdout: string; stderr: string; io: { stdout: { write(value: string): void }; stderr: { write(value: string): void }; process: { exitCode: number | null } } } {
  const result: { stdout: string; stderr: string; io: { stdout: { write(value: string): void }; stderr: { write(value: string): void }; process: { exitCode: number | null } } } = {
    stdout: '', stderr: '', io: { stdout: { write: (value) => { result.stdout += value; } }, stderr: { write: (value) => { result.stderr += value; } }, process: { exitCode: null } },
  };
  return result;
}

async function exitWithin(child: ReturnType<typeof Bun.spawn>, timeoutMs: number): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      child.exited.then((exitCode) => ({ timedOut: false as const, exitCode })),
      new Promise<{ timedOut: true }>((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs); }),
    ]);
    if (!result.timedOut) return result.exitCode;
    child.kill(9);
    await child.exited;
    throw new Error(`Import child exceeded ${timeoutMs}ms`);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function runFreshGuardedImport(modulePath: string, environment: Record<string, string>): Promise<void> {
  const moduleUrl = pathToFileURL(join(process.cwd(), modulePath.replace('../', ''))).href;
  const source = [
    'let fetchCalls = 0;',
    'globalThis.fetch = () => { fetchCalls += 1; throw new Error("fetch disabled by import test"); };',
    `await import(${JSON.stringify(moduleUrl)});`,
    'await new Promise((resolve) => setTimeout(resolve, 20));',
    'if (fetchCalls !== 0) throw new Error("import invoked fetch");',
  ].join(' ');
  const child = Bun.spawn([process.execPath, '-e', source], { env: environment, stdout: 'pipe', stderr: 'pipe' });
  expect(await exitWithin(child, 2_000)).toBe(0);
  expect(await new Response(child.stdout).text()).toBe('');
  expect(await new Response(child.stderr).text()).toBe('');
}

async function snapshotRuntimeTrees(...directories: string[]): Promise<string[][]> {
  return Promise.all(directories.map(async (directory) => (await readdir(directory, { recursive: true })).sort()));
}

afterEach(async () => {
  const roots = harnessRoots.splice(0);
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  await Promise.all(roots.map(async (root) => expect(await Bun.file(root).exists()).toBe(false)));
});

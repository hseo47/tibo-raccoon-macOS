import { afterEach, expect, test } from 'bun:test';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';

import { type InstallDependencies, installPlugin } from '../scripts/install';
import { type UninstallDependencies, uninstallPlugin } from '../scripts/uninstall';
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
  expect(operations.every((path) => path.startsWith(harnessRoot(harness)))).toBe(true);
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

test('tool imports do not initiate filesystem work', async () => {
  const harness = await installHarness();
  const before = await readdir(harnessRoot(harness), { recursive: true });
  await import('../scripts/install');
  await import('../scripts/uninstall');
  expect(await readdir(harnessRoot(harness), { recursive: true })).toEqual(before);
});

async function installHarness(options: {
  pluginDirectoryName?: string;
  rename?: InstallDependencies['rename'];
} = {}): Promise<InstallHarness> {
  const root = await mkdtemp(join(tmpdir(), 'tibo-raccoon-install-'));
  harnessRoots.push(root);
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
      await writeFile(output, '#!/fake/bun\nartifact\n', { mode: 0o755 });
    }) as typeof buildPlugin,
    stat: async (path) => { record('stat', path); return stat(path); },
    makeTempDirectory: async () => {
      const directory = await mkdtemp(join(root, 'build-'));
      record('makeTempDirectory', directory);
      return directory;
    },
    copyFile: async (source, destination) => { record('copyFile', source, destination); await copyFile(source, destination); },
    chmod: async (path, mode) => { record('chmod', path); await chmod(path, mode); },
    rename: options.rename ?? (async (source, destination) => { record('rename', source, destination); await rename(source, destination); }),
    removeTempDirectory: async (path) => { record('removeTempDirectory', path); await rm(path, { recursive: true, force: true }); },
  };
  Object.defineProperty(dependencies, '__root', { value: root });
  Object.defineProperty(dependencies, '__operations', { value: operations });
  return { pluginDirectory, stateFile, bunPath, dependencies };
}

function harnessRoot(harness: InstallHarness): string {
  return (harness.dependencies as InstallDependencies & { __root: string }).__root;
}

async function assertHarnessOperationsStayInRoot(harness: InstallHarness): Promise<void> {
  const { __root: root, __operations: operations } = harness.dependencies as InstallDependencies & { __root: string; __operations: RecordedOperation[] };
  expect(root.startsWith(tmpdir())).toBe(true);
  expect(operations.length).toBeGreaterThan(0);
  expect(operations.flatMap(({ paths }) => paths).every((path) => isAbsolute(path) && path.startsWith(root))).toBe(true);
}

afterEach(async () => {
  await Promise.all(harnessRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

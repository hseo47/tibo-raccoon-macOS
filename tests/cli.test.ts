import { afterEach, expect, test } from 'bun:test';
import { lstat, mkdtemp, realpath, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';

import type { RaccoonState, RuntimeNotice } from '../src/domain';
import { runCli, type CliDependencies } from '../src/cli';
import { resolvePluginPath, resolveStatePaths, runProductionCli, writeCliResult } from '../src/main';
import type { PollMode, PollResult } from '../src/poll';
import { post, stateWith } from './helpers/factories';

type CliHarness = {
  deps: CliDependencies;
  readonly fetchCalls: number;
  readonly mutationCalls: number;
  readonly savedState: RaccoonState;
};

function cliHarness(options?: Partial<RaccoonState>): CliHarness {
  let current = stateWith(options);
  let fetchCalls = 0;
  let mutationCalls = 0;
  let pollResult: PollResult = { state: current, networkAttempted: true, notice: null };
  const deps: CliDependencies = {
    async poll(mode): Promise<PollResult> {
      void mode;
      fetchCalls += 1;
      return pollResult;
    },
    async mutateState(mutation): Promise<RaccoonState> {
      mutationCalls += 1;
      current = mutation(current);
      return current;
    },
    render(state, notice): string {
      void state;
      void notice;
      return 'complete menu';
    },
  };
  return {
    deps,
    get fetchCalls() { return fetchCalls; },
    get mutationCalls() { return mutationCalls; },
    get savedState() { return current; },
  };
}

test('no arguments runs one scheduled poll and renders its complete menu', async () => {
  const harness = cliHarness({ unreadIds: ['2'], knownIds: ['2'], cachedPosts: [post('2')] });
  const pollModes: PollMode[] = [];
  const rendered: Array<{ state: RaccoonState; notice: RuntimeNotice }> = [];
  const poll = harness.deps.poll;
  const render = harness.deps.render;
  harness.deps.poll = async (mode) => { pollModes.push(mode); return poll(mode); };
  harness.deps.render = (state, notice) => { rendered.push({ state, notice }); return render(state, notice); };

  const result = await runCli([], harness.deps);

  expect(result).toEqual({ stdout: 'complete menu', stderr: '', exitCode: 0 });
  expect(pollModes).toEqual(['scheduled']);
  expect(harness.fetchCalls).toBe(1);
  expect(rendered).toHaveLength(1);
});

test('no arguments return an error-state menu with exit zero when persistence notice is set', async () => {
  const harness = cliHarness();
  let renderedNotice: RuntimeNotice | undefined;
  harness.deps.poll = async (mode) => ({ state: stateWith(), networkAttempted: true, notice: 'state' });
  harness.deps.render = (_state, notice) => { renderedNotice = notice; return 'complete menu'; };

  const result = await runCli([], harness.deps);

  expect(result).toEqual({ stdout: 'complete menu', stderr: '', exitCode: 0 });
  expect(renderedNotice).toBe('state');
});

test('mark-read mutates state without rendering or fetching', async () => {
  const harness = cliHarness({ knownIds: ['2'], unreadIds: ['2'], cachedPosts: [post('2')] });
  harness.deps.render = () => { throw new Error('mark-read must not render'); };

  const result = await runCli(['mark-read'], harness.deps);

  expect(result).toEqual({ stdout: '', stderr: '', exitCode: 0 });
  expect(harness.fetchCalls).toBe(0);
  expect(harness.savedState.unreadIds).toEqual([]);
});

test('mark-read clears only the locked current unread IDs, preserving a concurrently newer unread item', async () => {
  const harness = cliHarness({ knownIds: ['old'], unreadIds: ['old'], cachedPosts: [post('old')] });
  let persisted: RaccoonState | undefined;
  harness.deps.mutateState = async (mutation) => {
    const markedRead = mutation(stateWith({ knownIds: ['old'], unreadIds: ['old'], cachedPosts: [post('old')] }));
    const newer = post('new', { publishedAt: '2026-08-30T00:00:00.000Z' });
    persisted = {
      ...markedRead,
      knownIds: ['new', 'old'],
      unreadIds: ['new'],
      cachedPosts: [newer, post('old')],
    };
    return persisted;
  };

  await runCli(['mark-read'], harness.deps);

  expect(persisted?.unreadIds).toEqual(['new']);
});

test('refresh-now performs exactly one forced poll and emits no menu', async () => {
  const harness = cliHarness();
  const pollModes: PollMode[] = [];
  harness.deps.render = () => { throw new Error('refresh-now must not render'); };
  const poll = harness.deps.poll;
  harness.deps.poll = async (mode) => { pollModes.push(mode); return poll(mode); };

  const result = await runCli(['refresh-now'], harness.deps);

  expect(result).toEqual({ stdout: '', stderr: '', exitCode: 0 });
  expect(pollModes).toEqual(['force']);
});

test('refresh-now exits zero for a handled feed failure', async () => {
  const harness = cliHarness();
  harness.deps.render = () => { throw new Error('scheduled poll failure must not render'); };
  harness.deps.poll = async () => ({
    state: stateWith({ consecutiveFailures: 1, lastError: 'network' }),
    networkAttempted: true,
    notice: null,
  });

  expect(await runCli(['refresh-now'], harness.deps)).toEqual({ stdout: '', stderr: '', exitCode: 0 });
});

test('refresh-now exits one when its mutation could not be persisted', async () => {
  const harness = cliHarness();
  harness.deps.poll = async () => ({ state: stateWith(), networkAttempted: true, notice: 'state' });

  expect(await runCli(['refresh-now'], harness.deps)).toEqual({
    stdout: '', stderr: 'State refresh could not be saved\n', exitCode: 1,
  });
});

test('mark-read returns a fixed sanitized error when the locked mutation fails', async () => {
  const harness = cliHarness();
  harness.deps.mutateState = async () => { throw new Error('/private/state.json token=secret'); };

  const result = await runCli(['mark-read'], harness.deps);

  expect(result).toEqual({ stdout: '', stderr: 'State update could not be saved\n', exitCode: 1 });
  expect(result.stderr).not.toContain('/private');
  expect(result.stderr).not.toContain('secret');
});

test('unexpected scheduled poll errors return a fixed sanitized error without attempting rendering', async () => {
  const harness = cliHarness();
  harness.deps.poll = async () => { throw new Error('/private/state.json token=secret'); };

  const result = await runCli([], harness.deps);

  expect(result).toEqual({ stdout: '', stderr: 'Scheduled refresh could not be completed\n', exitCode: 1 });
});

test('unknown and multiple arguments are inert and return usage exit code', async () => {
  const harness = cliHarness({ knownIds: ['2'], unreadIds: ['2'], cachedPosts: [post('2')] });
  harness.deps.render = () => { throw new Error('invalid actions must not render'); };

  for (const argv of [['delete-state'], ['mark-read', 'extra']]) {
    expect(await runCli(argv, harness.deps)).toEqual({
      stdout: '', stderr: 'Usage: tibo-raccoon.2m.js [mark-read|refresh-now]\n', exitCode: 64,
    });
  }
  expect(harness.mutationCalls).toBe(0);
  expect(harness.fetchCalls).toBe(0);
});

const TEST_STATE_MARKER = '.tibo-raccoon-test-state';
const TEST_STATE_MARKER_CONTENT = 'tibo-raccoon-test-state-v1\n';
const trackedTemporaryEntries: string[] = [];

async function trackedMkdtemp(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  trackedTemporaryEntries.push(directory);
  return directory;
}

async function trackedSymlink(target: string, path: string): Promise<void> {
  expect(join(tmpdir(), basename(path))).toBe(path);
  await expect(lstat(path)).rejects.toThrow();
  await symlink(target, path);
  trackedTemporaryEntries.push(path);
}

afterEach(async () => {
  for (const path of trackedTemporaryEntries.splice(0).reverse()) {
    expect(join(tmpdir(), basename(path))).toBe(path);
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || entry.isFile()) await unlink(path);
    else await rm(path, { recursive: true, force: true });
    await expect(lstat(path)).rejects.toThrow();
  }
});

async function markTestStateDirectory(directory: string): Promise<void> {
  await writeFile(join(directory, TEST_STATE_MARKER), TEST_STATE_MARKER_CONTENT);
}

test('production path resolution accepts only representable plugin paths and owned direct temporary state leaves', async () => {
  const testDirectory = await trackedMkdtemp('tibo-raccoon-state-');
  const allowedStateDirectory = await trackedMkdtemp('tibo-raccoon-state-');
  const unknownEntryDirectory = await trackedMkdtemp('tibo-raccoon-state-');
  const productionDirectory = await trackedMkdtemp('tibo-raccoon-state-');
  const broadDirectory = await trackedMkdtemp('broad-repository-like-');
  const wrongPrefixDirectory = await trackedMkdtemp('wrong-prefix-');
  const missingDirectory = join(testDirectory, 'missing');
  const existingFile = join(broadDirectory, 'not-a-directory');
  const markerSymlinkDirectory = await trackedMkdtemp('tibo-raccoon-state-');
  const symlinkDirectory = `${testDirectory}-symlink`;
  const productionAlias = join(tmpdir(), `tibo-raccoon-alias-${crypto.randomUUID()}`);
  const absoluteExecutable = '/Applications/SwiftBar Plugins/tibo-raccoon.2m.js';
  await writeFile(existingFile, 'not a state directory');
  await markTestStateDirectory(testDirectory);
  await markTestStateDirectory(allowedStateDirectory);
  await writeFile(join(allowedStateDirectory, 'state.json'), JSON.stringify(stateWith()));
  await writeFile(join(allowedStateDirectory, 'state.lock.owner-11111111-1111-4111-8111-111111111111'), 'crash residue');
  await writeFile(join(allowedStateDirectory, 'state.lock.reclaim.owner-22222222-2222-4222-8222-222222222222'), 'crash residue');
  await markTestStateDirectory(unknownEntryDirectory);
  await writeFile(join(unknownEntryDirectory, 'unexpected.txt'), 'must reject');
  await markTestStateDirectory(productionDirectory);
  await markTestStateDirectory(broadDirectory);
  await markTestStateDirectory(wrongPrefixDirectory);
  await symlink(join(testDirectory, TEST_STATE_MARKER), join(markerSymlinkDirectory, TEST_STATE_MARKER));
  await trackedSymlink(testDirectory, symlinkDirectory);
  await trackedSymlink(tmpdir(), productionAlias);
  const broadMode = (await stat(broadDirectory)).mode & 0o777;
  const broadMarker = await Bun.file(join(broadDirectory, TEST_STATE_MARKER)).text();

  expect(resolvePluginPath({ SWIFTBAR_PLUGIN_PATH: 'relative.js' }, absoluteExecutable)).toBe(absoluteExecutable);
  expect(resolvePluginPath({ SWIFTBAR_PLUGIN_PATH: '/safe/plugin.js' }, absoluteExecutable)).toBe('/safe/plugin.js');
  for (const unsafe of [
    '/unsafe\nplugin.2m.js',
    '/unsafe\u0001plugin.2m.js',
    '/unsafe\u0085plugin.2m.js',
    '/unsafe\u2028plugin.2m.js',
    '/unsafe\u2029plugin.2m.js',
    '/unsafe/plugin.2m.js\\',
    '/unsafe/both\'"quotes.2m.js',
  ]) {
    expect(resolvePluginPath({ SWIFTBAR_PLUGIN_PATH: unsafe }, absoluteExecutable)).toBe(absoluteExecutable);
  }
  expect(() => resolvePluginPath({}, '/unsafe/plugin.2m.js\\')).toThrow('SwiftBar action path is unavailable');
  expect(() => resolvePluginPath({}, '/unsafe/both\'"quotes.2m.js')).toThrow('SwiftBar action path is unavailable');
  expect(resolveStatePaths({}, productionDirectory).directory).toBe(productionDirectory);
  expect(resolveStatePaths({ TIBO_RACCOON_TEST_MODE: '0', TIBO_RACCOON_TEST_STATE_DIR: testDirectory }, productionDirectory).directory).toBe(productionDirectory);
  for (const rejected of [
    'relative', missingDirectory, existingFile, markerSymlinkDirectory, symlinkDirectory, productionDirectory,
    `${productionAlias}/${productionDirectory.slice(tmpdir().length + 1)}`, broadDirectory, wrongPrefixDirectory,
    unknownEntryDirectory, tmpdir(), process.cwd(), '/',
  ]) {
    expect(() => resolveStatePaths({ TIBO_RACCOON_TEST_MODE: '1', TIBO_RACCOON_TEST_STATE_DIR: rejected }, productionDirectory)).toThrow('Test state configuration is invalid');
  }
  expect(() => resolveStatePaths({ TIBO_RACCOON_TEST_MODE: '1' }, productionDirectory)).toThrow('Test state configuration is invalid');
  expect(resolveStatePaths({ TIBO_RACCOON_TEST_MODE: '1', TIBO_RACCOON_TEST_STATE_DIR: testDirectory }, productionDirectory).directory).toBe(await realpath(testDirectory));
  expect(resolveStatePaths({ TIBO_RACCOON_TEST_MODE: '1', TIBO_RACCOON_TEST_STATE_DIR: allowedStateDirectory }, productionDirectory).directory).toBe(await realpath(allowedStateDirectory));
  expect(isAbsolute(testDirectory)).toBe(true);
  expect(await Bun.file(missingDirectory).exists()).toBe(false);
  expect((await lstat(symlinkDirectory)).isSymbolicLink()).toBe(true);
  expect((await lstat(join(markerSymlinkDirectory, TEST_STATE_MARKER))).isSymbolicLink()).toBe(true);
  expect((await stat(broadDirectory)).mode & 0o777).toBe(broadMode);
  expect(await Bun.file(join(broadDirectory, TEST_STATE_MARKER)).text()).toBe(broadMarker);
});

test('accepted test state aliases return the immutable canonical temporary leaf', async () => {
  const candidate = await trackedMkdtemp('tibo-raccoon-state-');
  const productionDirectory = await trackedMkdtemp('tibo-raccoon-state-');
  const retarget = await trackedMkdtemp('unrelated-alias-target-');
  const alias = join(tmpdir(), `tibo-raccoon-canonical-alias-${crypto.randomUUID()}`);
  await markTestStateDirectory(candidate);
  await trackedSymlink(tmpdir(), alias);

  const aliasCandidate = join(alias, basename(candidate));
  const paths = resolveStatePaths({ TIBO_RACCOON_TEST_MODE: '1', TIBO_RACCOON_TEST_STATE_DIR: aliasCandidate }, productionDirectory);
  const canonicalCandidate = await realpath(candidate);

  expect(paths.directory).toBe(canonicalCandidate);
  await unlink(alias);
  await symlink(retarget, alias);
  expect(paths.directory).toBe(canonicalCandidate);
  expect(paths.stateFile).toBe(join(canonicalCandidate, 'state.json'));
});

test('writer emits each non-empty stream exactly once and sets the result exit code', () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const target = { exitCode: 0 };

  writeCliResult({ stdout: 'menu', stderr: 'notice\n', exitCode: 1 }, {
    stdout: { write: (value) => { stdout.push(value); return true; } },
    stderr: { write: (value) => { stderr.push(value); return true; } },
    process: target,
  });

  expect(stdout).toEqual(['menu']);
  expect(stderr).toEqual(['notice\n']);
  expect(target.exitCode).toBe(1);
});

test('production CLI reports an unrepresentable fallback path with fixed stderr before wiring', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const target = { exitCode: 0 };

  await runProductionCli([], {
    environment: {},
    executablePath: '/unsafe/plugin.2m.js\\',
    writer: {
      stdout: { write: (value) => { stdout.push(value); return true; } },
      stderr: { write: (value) => { stderr.push(value); return true; } },
      process: target,
    },
  });

  expect(stdout).toEqual([]);
  expect(stderr).toEqual(['SwiftBar action path is unavailable\n']);
  expect(target.exitCode).toBe(1);
});

test('production CLI fails closed on missing test state configuration before fetch or state access', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const target = { exitCode: 0 };
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  const blockedFetch = Object.assign(
    (..._arguments: Parameters<typeof fetch>): ReturnType<typeof fetch> => {
      fetchCalls += 1;
      return Promise.reject(new Error('must not fetch'));
    },
    { preconnect: (_url: string | URL): void => undefined },
  ) satisfies typeof fetch;
  globalThis.fetch = blockedFetch;
  try {
    await runProductionCli([], {
      environment: { TIBO_RACCOON_TEST_MODE: '1' },
      executablePath: '/safe/tibo-raccoon.2m.js',
      writer: {
        stdout: { write: (value) => { stdout.push(value); return true; } },
        stderr: { write: (value) => { stderr.push(value); return true; } },
        process: target,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(fetchCalls).toBe(0);
  expect(stdout).toEqual([]);
  expect(stderr).toEqual(['Test state configuration is invalid\n']);
  expect(target.exitCode).toBe(1);
});

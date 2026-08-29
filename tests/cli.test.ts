import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';

import type { RaccoonState, RuntimeNotice } from '../src/domain';
import { runCli, type CliDependencies } from '../src/cli';
import { resolvePluginPath, resolveStatePaths, writeCliResult } from '../src/main';
import type { PollMode, PollResult } from '../src/poll';
import { post, stateWith } from './helpers/factories';

type CliHarness = {
  deps: CliDependencies;
  readonly fetchCalls: number;
  readonly mutationCalls: number;
  readonly savedState: RaccoonState;
  readonly rendered: Array<{ state: RaccoonState; notice: RuntimeNotice }>;
  readonly pollModes: PollMode[];
};

function cliHarness(options: Partial<RaccoonState> = {}): CliHarness {
  let current = stateWith(options);
  let fetchCalls = 0;
  let mutationCalls = 0;
  const rendered: Array<{ state: RaccoonState; notice: RuntimeNotice }> = [];
  const pollModes: PollMode[] = [];
  let pollResult: PollResult = { state: current, networkAttempted: true, notice: null };
  const deps: CliDependencies = {
    async poll(mode): Promise<PollResult> {
      pollModes.push(mode);
      fetchCalls += 1;
      return pollResult;
    },
    async mutateState(mutation): Promise<RaccoonState> {
      mutationCalls += 1;
      current = mutation(current);
      return current;
    },
    render(state, notice): string {
      rendered.push({ state, notice });
      return 'complete menu';
    },
  };
  return {
    deps,
    get fetchCalls() { return fetchCalls; },
    get mutationCalls() { return mutationCalls; },
    get savedState() { return current; },
    get rendered() { return rendered; },
    get pollModes() { return pollModes; },
  };
}

test('no arguments runs one scheduled poll and renders its complete menu', async () => {
  const harness = cliHarness({ unreadIds: ['2'], knownIds: ['2'], cachedPosts: [post('2')] });

  const result = await runCli([], harness.deps);

  expect(result).toEqual({ stdout: 'complete menu', stderr: '', exitCode: 0 });
  expect(harness.pollModes).toEqual(['scheduled']);
  expect(harness.fetchCalls).toBe(1);
  expect(harness.rendered).toHaveLength(1);
});

test('no arguments return an error-state menu with exit zero when persistence notice is set', async () => {
  const harness = cliHarness();
  harness.deps.poll = async (mode) => ({ state: stateWith(), networkAttempted: true, notice: 'state' });

  const result = await runCli([], harness.deps);

  expect(result).toEqual({ stdout: 'complete menu', stderr: '', exitCode: 0 });
  expect(harness.rendered[0]?.notice).toBe('state');
});

test('mark-read mutates state without rendering or fetching', async () => {
  const harness = cliHarness({ knownIds: ['2'], unreadIds: ['2'], cachedPosts: [post('2')] });

  const result = await runCli(['mark-read'], harness.deps);

  expect(result).toEqual({ stdout: '', stderr: '', exitCode: 0 });
  expect(harness.fetchCalls).toBe(0);
  expect(harness.rendered).toEqual([]);
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

  const result = await runCli(['refresh-now'], harness.deps);

  expect(result).toEqual({ stdout: '', stderr: '', exitCode: 0 });
  expect(harness.pollModes).toEqual(['force']);
  expect(harness.rendered).toEqual([]);
});

test('refresh-now exits zero for a handled feed failure', async () => {
  const harness = cliHarness();
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
  expect(harness.rendered).toEqual([]);
});

test('unknown and multiple arguments are inert and return usage exit code', async () => {
  const harness = cliHarness({ knownIds: ['2'], unreadIds: ['2'], cachedPosts: [post('2')] });

  for (const argv of [['delete-state'], ['mark-read', 'extra']]) {
    expect(await runCli(argv, harness.deps)).toEqual({
      stdout: '', stderr: 'Usage: tibo-raccoon.2m.js [mark-read|refresh-now]\n', exitCode: 64,
    });
  }
  expect(harness.mutationCalls).toBe(0);
  expect(harness.fetchCalls).toBe(0);
  expect(harness.rendered).toEqual([]);
});

test('production path resolution accepts only absolute plugin and validated test-state directories', async () => {
  const testDirectory = await mkdtemp(join(tmpdir(), 'tibo-raccoon-cli-'));
  const missingDirectory = join(testDirectory, 'missing');
  const existingFile = join(testDirectory, 'not-a-directory');
  const absoluteExecutable = '/Applications/SwiftBar Plugins/tibo-raccoon.2m.js';
  await writeFile(existingFile, 'not a state directory');

  expect(resolvePluginPath({ SWIFTBAR_PLUGIN_PATH: 'relative.js' }, absoluteExecutable)).toBe(absoluteExecutable);
  expect(resolvePluginPath({ SWIFTBAR_PLUGIN_PATH: '/safe/plugin.js' }, absoluteExecutable)).toBe('/safe/plugin.js');
  expect(resolveStatePaths({}, '/production/state').directory).toBe('/production/state');
  expect(resolveStatePaths({ TIBO_RACCOON_TEST_MODE: '0', TIBO_RACCOON_TEST_STATE_DIR: testDirectory }, '/production/state').directory).toBe('/production/state');
  expect(resolveStatePaths({ TIBO_RACCOON_TEST_MODE: '1', TIBO_RACCOON_TEST_STATE_DIR: 'relative' }, '/production/state').directory).toBe('/production/state');
  expect(resolveStatePaths({ TIBO_RACCOON_TEST_MODE: '1', TIBO_RACCOON_TEST_STATE_DIR: missingDirectory }, '/production/state').directory).toBe('/production/state');
  expect(resolveStatePaths({ TIBO_RACCOON_TEST_MODE: '1', TIBO_RACCOON_TEST_STATE_DIR: existingFile }, '/production/state').directory).toBe('/production/state');
  expect(resolveStatePaths({ TIBO_RACCOON_TEST_MODE: '1', TIBO_RACCOON_TEST_STATE_DIR: testDirectory }, '/production/state').directory).toBe(testDirectory);
  expect(isAbsolute(testDirectory)).toBe(true);
  expect(await Bun.file(missingDirectory).exists()).toBe(false);
  await mkdir(join(testDirectory, 'nested'));
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

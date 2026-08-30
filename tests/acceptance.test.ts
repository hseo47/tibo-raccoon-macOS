import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import { runCli, type CliResult } from '../src/cli';
import type { FeedErrorKind, Post } from '../src/domain';
import { FeedError } from '../src/feed/client';
import { normalizeDayclawPayload } from '../src/feed/normalize';
import { poll } from '../src/poll';
import { applySuccessfulPoll, createInitialState } from '../src/state/model';
import { defaultStatePaths, loadState, mutateState, type StatePaths } from '../src/state/store';
import { renderSwiftBarMenu, selectMenuPosts } from '../src/swiftbar/render';
import { isRepresentableSwiftBarPluginPath } from '../src/swiftbar/plugin-path';
import { post } from './helpers/factories';
import { FakeClock } from './helpers/fake-clock';

const ACCEPTANCE_ROOT_PREFIX = 'tibo-raccoon-acceptance-';
const CALM_LIGHT_SHA256 = '090ae57eb9ad9abde97c346708d406be92f779c8ca5785adf31fe2e9a5485ff0';
const CALM_DARK_SHA256 = '1a0eb3a4467a0d7b874b648b02e6bd5ded97764bebd179b17a18da09b5998088';
const UNREAD_LIGHT_SHA256 = 'e45715ffb73282da58f9bc25f5019e6fba5ae7448e7026657636c08d41868af0';
const UNREAD_DARK_SHA256 = 'd5f106490ac25d2f731fa1f5c3ac4ebffa423a157662e64005b323c43a7a9443';
const OFFLINE_LIGHT_SHA256 = 'ab863510c457e6cd346bc264f21accc0b746d4b5be2cd9e7c9403fac4d6a5db6';
const OFFLINE_DARK_SHA256 = '0fbfe29c39fbfc201fb0841dae5390a52913ce0f73c430265c8a8f5c2725dfa7';

type AcceptanceHarness = {
  feed: Post[];
  render(): Promise<string>;
  action(name: 'mark-read' | 'refresh-now'): Promise<CliResult>;
  failNext(kind: FeedErrorKind): void;
  advance(milliseconds: number): void;
  statePaths: StatePaths;
};

type FetchBarrier = {
  readonly started: Promise<void>;
  signalStarted(): void;
  release(posts: Post[]): void;
  cancel(): void;
  waitForPosts(): Promise<Post[]>;
};

const rootsByStateDirectory = new Map<string, string>();
const fetchCallsByStateDirectory = new Map<string, number>();
let nextFetchBarrier: FetchBarrier | null = null;

test('normalizer, state, and menu share the UTF-16 opaque-ID ordering contract', () => {
  const normalized = normalizeDayclawPayload({
    items: [
      { id: 'z', content: 'unavailable time' },
      { id: '\u00e4', content: 'unavailable time' },
      { id: '\u{10000}', content: 'same time', publishedAt: '2026-08-29T00:00:00Z' },
      { id: '\uE000', content: 'same time', publishedAt: '2026-08-29T00:00:00Z' },
    ],
  });
  const state = applySuccessfulPoll(
    createInitialState({ recoveryPending: true }),
    normalized,
    '2026-08-29T00:01:00.000Z',
  );

  expect(normalized.map(({ id }) => id)).toEqual(['\uE000', '\u{10000}', '\u00e4', 'z']);
  expect(state.knownIds).toEqual(['z', '\u00e4', '\u{10000}', '\uE000']);
  expect(state.unreadIds).toEqual(['\uE000', '\u{10000}', '\u00e4', 'z']);
  expect(selectMenuPosts(state).map(({ id }) => id)).toEqual(['\uE000', '\u{10000}', '\u00e4', 'z']);
});

function acceptanceHarness(options: { baseline: Post[] }): Promise<AcceptanceHarness> {
  return createAcceptanceHarness(options);
}

async function createAcceptanceHarness(options: { baseline: Post[] }): Promise<AcceptanceHarness> {
  const root = await mkdtemp(join(tmpdir(), ACCEPTANCE_ROOT_PREFIX));
  const stateDirectory = join(root, 'state');
  await mkdir(stateDirectory, { mode: 0o700 });
  const statePaths = defaultStatePaths({ testDirectory: stateDirectory });
  const clock = new FakeClock('2026-08-30T00:00:00.000Z');
  const feed = options.baseline.map(clonePost);
  const failures: FeedErrorKind[] = [];
  const pluginPath = join(root, 'tibo-raccoon.2m.js');
  if (!isAbsolute(pluginPath) || !isRepresentableSwiftBarPluginPath(pluginPath)) {
    throw new Error('Acceptance plugin path must be representable and absolute');
  }

  rootsByStateDirectory.set(stateDirectory, root);
  fetchCallsByStateDirectory.set(stateDirectory, 0);

  const fetchPosts = async (): Promise<Post[]> => {
    fetchCallsByStateDirectory.set(stateDirectory, (fetchCallsByStateDirectory.get(stateDirectory) ?? 0) + 1);
    const barrier = nextFetchBarrier;
    if (barrier !== null) {
      nextFetchBarrier = null;
      barrier.signalStarted();
      return (await barrier.waitForPosts()).map(clonePost);
    }
    const failure = failures.shift();
    if (failure !== undefined) throw new FeedError(failure, 'Injected acceptance failure');
    return feed.map(clonePost);
  };

  const pollWithRealStore = (mode: 'scheduled' | 'force') => poll(mode, {
    clock,
    loadState: () => loadState(statePaths),
    mutateState: (mutation) => mutateState(statePaths, mutation),
    fetchPosts,
  });

  return {
    feed,
    render: async () => {
      const result = await runCli([], {
        poll: pollWithRealStore,
        mutateState: (mutation) => mutateState(statePaths, mutation),
        render: (state, notice) => renderSwiftBarMenu({
          state,
          notice,
          pluginPath,
          locale: 'en-US',
          timeZone: 'UTC',
        }),
      });
      expect(result).toEqual({ stdout: expect.any(String), stderr: '', exitCode: 0 });
      return result.stdout;
    },
    action: (name) => runCli([name], {
      poll: pollWithRealStore,
      mutateState: (mutation) => mutateState(statePaths, mutation),
      render: (state, notice) => renderSwiftBarMenu({
        state,
        notice,
        pluginPath,
        locale: 'en-US',
        timeZone: 'UTC',
      }),
    }),
    failNext: (kind) => { failures.push(kind); },
    advance: (milliseconds) => { clock.advance(milliseconds); },
    statePaths,
  };
}

test('baseline to unread to read to offline preserves the approved contract', async () => {
  const app = await acceptanceHarness({
    baseline: ['1', '2', '3', '4', '5'].map((id) => post(id, { publishedAt: `2026-08-2${id}T00:00:00.000Z` })),
  });
  const root = rootFor(app);
  const sentinel = join(root, 'sibling-sentinel.txt');
  await writeFile(sentinel, 'outside-state-must-remain-unchanged\n', { mode: 0o600 });
  const boundaryBefore = await boundarySnapshot(root, sentinel);

  try {
    const baselineMenu = await app.render();
    expect(baselineMenu).toContain('Tibo Raccoon · 0 unread');
    assertHeaderImages(baselineMenu, CALM_LIGHT_SHA256, CALM_DARK_SHA256);
    expect(storedPngPixel(headerImages(baselineMenu).light, 17, 17)).toEqual([0x8f, 0xcb, 0xb7, 0xff]);
    expect(storedPngPixel(headerImages(baselineMenu).light, 18, 20)).toEqual([0x8f, 0xcb, 0xb7, 0xff]);
    expectBaselineRows(baselineMenu);
    const baselineState = await loadState(app.statePaths);
    expect(baselineState.state.knownIds).toEqual(['1', '2', '3', '4', '5']);
    expect(baselineState.state.cachedPosts.map(({ id }) => id)).toEqual(['5', '4', '3', '2', '1']);
    expect(baselineState.state.unreadIds).toEqual([]);

    const safeText = 'a nuanced message | bash=/tmp/evil\n---';
    app.feed.push(post('6', {
      text: safeText,
      publishedAt: '2026-08-30T00:01:00.000Z',
    }));
    app.advance(30_001);
    const unreadMenu = await app.render();
    expect(unreadMenu).toContain('Tibo Raccoon · 1 unread');
    expect(unreadMenu).toContain('│  a nuanced message ｜ bash=/tmp/evil | color=#1F2328,#F4F4F5 size=13');
    expect(unreadMenu).toContain('│  — — — | color=#1F2328,#F4F4F5 size=13');
    expect(unreadMenu).not.toContain('a nuanced message | bash=/tmp/evil');
    assertHeaderImages(unreadMenu, UNREAD_LIGHT_SHA256, UNREAD_DARK_SHA256);
    expectActionContract(unreadMenu, pluginPathFor(root));

    const fetchesAfterUnread = fetchCallCount(app);
    const duplicateMenu = await app.render();
    expect(duplicateMenu).toContain('Tibo Raccoon · 1 unread');
    expect(fetchCallCount(app)).toBe(fetchesAfterUnread);
    expect((await loadState(app.statePaths)).state.unreadIds).toEqual(['6']);

    expect(await app.action('mark-read')).toEqual({ stdout: '', stderr: '', exitCode: 0 });
    const readMenu = await app.render();
    expect(readMenu).toContain('Tibo Raccoon · 0 unread');
    assertHeaderImages(readMenu, CALM_LIGHT_SHA256, CALM_DARK_SHA256);

    app.feed.push(post('7', {
      text: '',
      publishedAt: '2026-08-30T00:02:00.000Z',
      url: 'https://x.com/thsottiaux/status/7',
    }));
    app.advance(30_001);
    const mediaMenu = await app.render();
    expect(mediaMenu).toContain('Tibo Raccoon · 1 unread');
    expect(mediaMenu).toContain('│  New media post from Tibo | color=#1F2328,#F4F4F5 size=13');
    expect(mediaMenu).toContain('╰─ Read full post on X → | href=https://x.com/thsottiaux/status/7');
    expect(mediaMenu.split('\n').slice(1).every((line) => !/(?:^|\s)image=/.test(line))).toBe(true);
    assertHeaderImages(mediaMenu, UNREAD_LIGHT_SHA256, UNREAD_DARK_SHA256);

    app.failNext('network');
    app.failNext('timeout');
    app.failNext('malformed');
    const failurePlan: ReadonlyArray<readonly [FeedErrorKind, number]> = [
      ['network', 2],
      ['timeout', 4],
      ['malformed', 8],
    ];
    for (const [kind, backoffMinutes] of failurePlan) {
      expect(await app.action('refresh-now')).toEqual({ stdout: '', stderr: '', exitCode: 0 });
      const failed = await loadState(app.statePaths);
      expect(failed.state.lastError).toBe(kind);
      expect(Date.parse(failed.state.nextRetryAt!) - Date.parse(failed.state.lastAttemptAt!)).toBe(backoffMinutes * 60_000);

      const fetchesBeforeBackoffRender = fetchCallCount(app);
      app.advance(30_001);
      const backoffMenu = await app.render();
      expect(fetchCallCount(app)).toBe(fetchesBeforeBackoffRender);
      expect(backoffMenu).toContain('Tibo Raccoon · 1 unread');
      expect(backoffMenu).toContain('│  New media post from Tibo | color=#1F2328,#F4F4F5 size=13');
      expect((await loadState(app.statePaths)).state.lastAttemptAt).toBe(failed.state.lastAttemptAt);
    }
    const unreadDuringFailures = await app.render();
    expect(unreadDuringFailures).toContain('│  New media post from Tibo | color=#1F2328,#F4F4F5 size=13');
    expect(unreadDuringFailures).toContain('Feed offline · showing cached posts');
    assertHeaderImages(unreadDuringFailures, UNREAD_LIGHT_SHA256, UNREAD_DARK_SHA256);
    expect((await loadState(app.statePaths)).state.consecutiveFailures).toBe(3);

    expect(await app.action('mark-read')).toEqual({ stdout: '', stderr: '', exitCode: 0 });
    const offlineMenu = await app.render();
    expect(offlineMenu).toContain('Tibo Raccoon · 0 unread');
    expect(offlineMenu).toContain('│  New media post from Tibo | color=#1F2328,#F4F4F5 size=13');
    expect(offlineMenu).toContain('Feed offline · showing cached posts');
    assertHeaderImages(offlineMenu, OFFLINE_LIGHT_SHA256, OFFLINE_DARK_SHA256);

    expect(await app.action('refresh-now')).toEqual({ stdout: '', stderr: '', exitCode: 0 });
    const recovered = await loadState(app.statePaths);
    expect(recovered.state.consecutiveFailures).toBe(0);
    expect(recovered.state.lastError).toBeNull();
    expect(recovered.state.unreadIds).toEqual([]);
    expect(recovered.state.knownIds).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    const recoveredMenu = await app.render();
    assertHeaderImages(recoveredMenu, CALM_LIGHT_SHA256, CALM_DARK_SHA256);

    const barrier = createFetchBarrier();
    nextFetchBarrier = barrier;
    let forcedPoll: Promise<CliResult> | undefined;
    try {
      forcedPoll = app.action('refresh-now');
      await barrier.started;
      expect(await app.action('mark-read')).toEqual({ stdout: '', stderr: '', exitCode: 0 });
      const laterPost = post('8', { publishedAt: '2026-08-30T00:03:00.000Z' });
      app.feed.push(laterPost);
      barrier.release(app.feed);
      expect(await forcedPoll).toEqual({ stdout: '', stderr: '', exitCode: 0 });
      const afterConcurrentMerge = await loadState(app.statePaths);
      expect(afterConcurrentMerge.state.unreadIds).toEqual(['8']);
      expect(afterConcurrentMerge.state.knownIds).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    } finally {
      if (nextFetchBarrier === barrier) nextFetchBarrier = null;
      barrier.cancel();
      if (forcedPoll !== undefined) await forcedPoll.catch(() => undefined);
    }

    expect(await boundarySnapshot(root, sentinel)).toEqual(boundaryBefore);
    expect(await readdir(app.statePaths.directory)).toEqual(['state.json']);
    expect(await Bun.file(app.statePaths.stateFile).exists()).toBe(true);
    expect(await Bun.file(app.statePaths.lockFile).exists()).toBe(false);
    for (const path of [app.statePaths.directory, app.statePaths.stateFile, app.statePaths.lockFile]) {
      expect(relative(root, path).startsWith('..')).toBe(false);
    }
  } finally {
    nextFetchBarrier = null;
    await cleanupAcceptanceHarness(app);
  }
});

test('corrupt state recovery preserves bytes and alerts every current post', async () => {
  const app = await acceptanceHarness({
    baseline: [
      post('10', { text: 'recovery source ten', publishedAt: '2026-08-30T01:00:00.000Z' }),
      post('11', { text: 'recovery source eleven', publishedAt: '2026-08-30T01:01:00.000Z' }),
    ],
  });
  const corruptBytes = '{not-valid-state-json\n';

  try {
    await writeFile(app.statePaths.stateFile, corruptBytes, { mode: 0o600 });
    const beforeSuccessfulPoll = await loadState(app.statePaths);
    expect(beforeSuccessfulPoll.source).toBe('recovered');
    expect(beforeSuccessfulPoll.state.recoveryPending).toBe(true);

    const quarantine = (await readdir(app.statePaths.directory)).filter((name) => /^state\.json\.corrupt-\d{8}T\d{9}Z$/.test(name));
    expect(quarantine).toHaveLength(1);
    expect(await readFile(join(app.statePaths.directory, quarantine[0]!), 'utf8')).toBe(corruptBytes);
    expect((await stat(app.statePaths.stateFile)).mode & 0o777).toBe(0o600);

    const menu = await app.render();
    expect(menu).toContain('Tibo Raccoon · 2 unread');
    expect(menu).toContain('│  recovery source eleven | color=#1F2328,#F4F4F5 size=13');
    expect(menu).toContain('│  recovery source ten | color=#1F2328,#F4F4F5 size=13');
    assertHeaderImages(menu, UNREAD_LIGHT_SHA256, UNREAD_DARK_SHA256);

    const afterSuccessfulPoll = await loadState(app.statePaths);
    expect(afterSuccessfulPoll.source).toBe('existing');
    expect(afterSuccessfulPoll.state.recoveryPending).toBe(false);
    expect(afterSuccessfulPoll.state.knownIds).toEqual(['10', '11']);
    expect(afterSuccessfulPoll.state.unreadIds).toEqual(['11', '10']);
    expect(afterSuccessfulPoll.state.cachedPosts.map(({ id }) => id)).toEqual(['11', '10']);
    expect((await stat(app.statePaths.stateFile)).mode & 0o777).toBe(0o600);
  } finally {
    await cleanupAcceptanceHarness(app);
  }
});

function clonePost(item: Post): Post {
  return { ...item };
}

function rootFor(app: AcceptanceHarness): string {
  const root = rootsByStateDirectory.get(app.statePaths.directory);
  if (root === undefined) throw new Error('Acceptance root is missing');
  return root;
}

function pluginPathFor(root: string): string {
  return join(root, 'tibo-raccoon.2m.js');
}

function fetchCallCount(app: AcceptanceHarness): number {
  return fetchCallsByStateDirectory.get(app.statePaths.directory) ?? 0;
}

async function cleanupAcceptanceHarness(app: AcceptanceHarness): Promise<void> {
  const root = rootFor(app);
  if (relative(tmpdir(), root).startsWith('..') || !root.startsWith(join(tmpdir(), ACCEPTANCE_ROOT_PREFIX))) {
    throw new Error('Refusing to remove a non-acceptance temporary root');
  }
  rootsByStateDirectory.delete(app.statePaths.directory);
  fetchCallsByStateDirectory.delete(app.statePaths.directory);
  await rm(root, { recursive: true, force: true });
}

async function boundarySnapshot(root: string, sentinel: string): Promise<{
  entries: string[];
  sentinelText: string;
  sentinelMode: number;
}> {
  return {
    entries: await readdir(root),
    sentinelText: await readFile(sentinel, 'utf8'),
    sentinelMode: (await stat(sentinel)).mode & 0o777,
  };
}

function createFetchBarrier(): FetchBarrier {
  let signalStarted: (() => void) | undefined;
  let resolvePosts: ((posts: Post[]) => void) | undefined;
  let rejectPosts: ((reason: Error) => void) | undefined;
  let settled: { posts: Post[] } | { error: Error } | undefined;
  const settle = (outcome: { posts: Post[] } | { error: Error }) => {
    if (settled !== undefined) return;
    settled = outcome;
    if ('posts' in outcome) resolvePosts?.(outcome.posts);
    else rejectPosts?.(outcome.error);
  };
  return {
    started: new Promise<void>((resolve) => { signalStarted = resolve; }),
    signalStarted: () => signalStarted?.(),
    release: (posts) => settle({ posts }),
    cancel: () => settle({ error: new Error('Acceptance fetch barrier cancelled') }),
    waitForPosts: () => new Promise<Post[]>((resolve, reject) => {
      resolvePosts = resolve;
      rejectPosts = reject;
      if (settled === undefined) return;
      if ('posts' in settled) resolve(settled.posts);
      else reject(settled.error);
    }),
  };
}

function expectBaselineRows(menu: string): void {
  const lines = menu.split('\n');
  const expected = [
    ['╭─ Tibo · Aug 25, 2026 at 12:00 AM', '│  post 5'],
    ['╭─ Tibo · Aug 24, 2026 at 12:00 AM', '│  post 4'],
    ['╭─ Tibo · Aug 23, 2026 at 12:00 AM', '│  post 3'],
    ['╭─ Tibo · Aug 22, 2026 at 12:00 AM', '│  post 2'],
    ['╭─ Tibo · Aug 21, 2026 at 12:00 AM', '│  post 1'],
  ] as const;
  const textIndexes: number[] = [];
  for (const [header, text] of expected) {
    expect(lines.filter((line) => line.startsWith(`${header} | sfimage=quote.bubble.fill`))).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith(`${text} | color=`))).toHaveLength(1);
    textIndexes.push(lines.findIndex((line) => line.startsWith(`${text} | color=`)));
  }
  expect(textIndexes).toEqual([...textIndexes].sort((left, right) => left - right));
}

function headerImages(menu: string): { light: Uint8Array; dark: Uint8Array } {
  const firstLine = menu.split('\n')[0];
  const match = /^\| image=([^,\s]+),([^\s]+) dropdown=false$/.exec(firstLine ?? '');
  if (match === null) throw new Error('Menu header does not contain paired icon images');
  return {
    light: new Uint8Array(Buffer.from(match[1]!, 'base64')),
    dark: new Uint8Array(Buffer.from(match[2]!, 'base64')),
  };
}

function assertHeaderImages(menu: string, expectedLightHash: string, expectedDarkHash: string): void {
  const images = headerImages(menu);
  expect(sha256(images.light)).toBe(expectedLightHash);
  expect(sha256(images.dark)).toBe(expectedDarkHash);
}

function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}

function storedPngPixel(png: Uint8Array, x: number, y: number): readonly [number, number, number, number] {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = readPngChunks(png);
  expect(chunks.map(({ name }) => name)).toEqual(['IHDR', 'IDAT', 'IEND']);
  expect([...chunks[0]!.data]).toEqual([0, 0, 0, 31, 0, 0, 0, 23, 8, 6, 0, 0, 0]);
  const idat = chunks[1]!.data;
  expect([idat[0], idat[1]]).toEqual([0x78, 0x01]);
  expect(idat[2]! & 0b111).toBe(1);
  const length = idat[3]! | (idat[4]! << 8);
  expect(length).toBe(23 * (1 + 31 * 4));
  const payload = idat.subarray(7, 7 + length);
  const row = y * 125;
  expect(payload[row]).toBe(0);
  const offset = row + 1 + x * 4;
  return [payload[offset]!, payload[offset + 1]!, payload[offset + 2]!, payload[offset + 3]!];
}

function readPngChunks(png: Uint8Array): Array<{ name: string; data: Uint8Array }> {
  const chunks: Array<{ name: string; data: Uint8Array }> = [];
  let offset = 8;
  while (offset < png.length) {
    const length = new DataView(png.buffer, png.byteOffset + offset, 4).getUint32(0);
    const name = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    chunks.push({ name, data });
    offset += 12 + length;
  }
  expect(offset).toBe(png.length);
  return chunks;
}

function expectActionContract(menu: string, pluginPath: string): void {
  expect(menu.split('\n').filter((line) => line.includes(' | bash='))).toEqual([
    `Mark all as read | bash='${pluginPath}' param1=mark-read terminal=false refresh=true`,
    `Refresh now | bash='${pluginPath}' param1=refresh-now terminal=false refresh=true`,
  ]);
  expect(menu).toContain("Open Tibo's profile | href=https://x.com/thsottiaux");
}

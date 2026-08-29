import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import { runCli, type CliResult } from '../src/cli';
import type { FeedErrorKind, Post } from '../src/domain';
import { FeedError } from '../src/feed/client';
import { poll } from '../src/poll';
import { defaultStatePaths, loadState, mutateState, type StatePaths } from '../src/state/store';
import { renderSwiftBarMenu } from '../src/swiftbar/render';
import { isRepresentableSwiftBarPluginPath } from '../src/swiftbar/plugin-path';
import { post } from './helpers/factories';
import { FakeClock } from './helpers/fake-clock';

const ACCEPTANCE_ROOT_PREFIX = 'tibo-raccoon-acceptance-';
const CALM_LIGHT_SHA256 = '634b33bf51a56f8aa89cefb56b4dedacbec5bd080bc06fa25eb8603188748b5f';
const CALM_DARK_SHA256 = 'd126b462d565f3a1ef93ce46df5b3b61c9ae348dd6defc0086acd10a149a4a8d';
const UNREAD_LIGHT_SHA256 = 'b1d4b4b8b4ad16b5b4010c00022f56ae1081feafb51efc528434325be867d82f';
const UNREAD_DARK_SHA256 = '85e5c4755ca3d11397ce1e89ce338c02b3383bebb37cea057cbad65b00eedb51';
const OFFLINE_LIGHT_SHA256 = 'cabc517a15fa224951187a1eb30cb17d0d0b49b3a858b4c8ff35cc5fa45d2a75';
const OFFLINE_DARK_SHA256 = '2fab508119b511e6a7578137a2a856640ef942b79040035d5879cdfeb556d697';

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
  waitForPosts(): Promise<Post[]>;
};

const rootsByStateDirectory = new Map<string, string>();
const fetchCallsByStateDirectory = new Map<string, number>();
let nextFetchBarrier: FetchBarrier | null = null;

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
    expect(storedPngPixel(headerImages(baselineMenu).light, 21, 21)).toEqual([0x8f, 0xcb, 0xb7, 0xff]);
    expect(storedPngPixel(headerImages(baselineMenu).light, 22, 24)).toEqual([0x8f, 0xcb, 0xb7, 0xff]);

    const safeText = 'a nuanced message | bash=/tmp/evil\n---';
    app.feed.push(post('6', {
      text: safeText,
      publishedAt: '2026-08-30T00:01:00.000Z',
    }));
    app.advance(30_001);
    const unreadMenu = await app.render();
    expect(unreadMenu).toContain('Tibo Raccoon · 1 unread');
    expect(unreadMenu).toContain('  a nuanced message ｜ bash=/tmp/evil');
    expect(unreadMenu).toContain('  — — —');
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
    expect(mediaMenu).toContain('  New media post from Tibo');
    expect(mediaMenu).toContain('Open original post | href=https://x.com/thsottiaux/status/7');
    expect(mediaMenu.split('\n').slice(1).every((line) => !line.includes('image='))).toBe(true);
    assertHeaderImages(mediaMenu, UNREAD_LIGHT_SHA256, UNREAD_DARK_SHA256);

    app.failNext('network');
    app.failNext('timeout');
    app.failNext('malformed');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await app.action('refresh-now')).toEqual({ stdout: '', stderr: '', exitCode: 0 });
    }
    const unreadDuringFailures = await app.render();
    expect(unreadDuringFailures).toContain('  New media post from Tibo');
    expect(unreadDuringFailures).toContain('Feed offline · showing cached posts');
    assertHeaderImages(unreadDuringFailures, UNREAD_LIGHT_SHA256, UNREAD_DARK_SHA256);
    expect((await loadState(app.statePaths)).state.consecutiveFailures).toBe(3);

    expect(await app.action('mark-read')).toEqual({ stdout: '', stderr: '', exitCode: 0 });
    const offlineMenu = await app.render();
    expect(offlineMenu).toContain('Tibo Raccoon · 0 unread');
    expect(offlineMenu).toContain('  New media post from Tibo');
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
    const forcedPoll = app.action('refresh-now');
    await barrier.started;
    expect(await app.action('mark-read')).toEqual({ stdout: '', stderr: '', exitCode: 0 });
    const laterPost = post('8', { publishedAt: '2026-08-30T00:03:00.000Z' });
    app.feed.push(laterPost);
    barrier.release(app.feed);
    expect(await forcedPoll).toEqual({ stdout: '', stderr: '', exitCode: 0 });
    const afterConcurrentMerge = await loadState(app.statePaths);
    expect(afterConcurrentMerge.state.unreadIds).toEqual(['8']);
    expect(afterConcurrentMerge.state.knownIds).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);

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
  let release: ((posts: Post[]) => void) | undefined;
  return {
    started: new Promise<void>((resolve) => { signalStarted = resolve; }),
    signalStarted: () => signalStarted?.(),
    release: (posts) => release?.(posts),
    waitForPosts: () => new Promise<Post[]>((resolve) => { release = resolve; }),
  };
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
  expect([...chunks[0]!.data]).toEqual([0, 0, 0, 39, 0, 0, 0, 29, 8, 6, 0, 0, 0]);
  const idat = chunks[1]!.data;
  expect([idat[0], idat[1]]).toEqual([0x78, 0x01]);
  expect(idat[2]! & 0b111).toBe(1);
  const length = idat[3]! | (idat[4]! << 8);
  expect(length).toBe(29 * (1 + 39 * 4));
  const payload = idat.subarray(7, 7 + length);
  const row = y * 157;
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

import { expect, test } from 'bun:test';

import type { Post, RaccoonState } from '../src/domain';
import { FeedError } from '../src/feed/client';
import { poll, type PollDependencies } from '../src/poll';
import type { StateLoad } from '../src/state/store';
import { post, stateWith } from './helpers/factories';
import { FakeClock } from './helpers/fake-clock';

type PollHarness = {
  deps: PollDependencies;
  readonly fetchCalls: number;
  events: string[];
};

function pollHarness(options: {
  state?: RaccoonState;
  now?: string;
  events?: string[];
  fetchResult?: Post[] | FeedError;
} = {}): PollHarness {
  let current = options.state ?? stateWith();
  let fetchCalls = 0;
  const events = options.events ?? [];
  const clock = new FakeClock(options.now ?? '2026-08-29T00:00:00.000Z');
  const fetchResult = options.fetchResult ?? [post('1')];
  const deps: PollDependencies = {
    clock,
    async loadState(): Promise<StateLoad> {
      events.push('load');
      return { state: current, source: 'existing' };
    },
    async mutateState(mutation): Promise<RaccoonState> {
      events.push('mutate:start');
      current = mutation(current);
      events.push('mutate:end');
      return current;
    },
    async fetchPosts(): Promise<Post[]> {
      fetchCalls += 1;
      events.push('fetch:start');
      await Promise.resolve();
      events.push('fetch:end');
      if (fetchResult instanceof FeedError) throw fetchResult;
      return fetchResult;
    },
  };
  return { deps, get fetchCalls() { return fetchCalls; }, events };
}

test('due scheduled success fetches once, persists, and has no notice', async () => {
  const harness = pollHarness({
    state: stateWith({ initializedAt: '2026-08-28T00:00:00.000Z', knownIds: ['old'], cachedPosts: [post('old')] }),
    fetchResult: [post('new'), post('old')],
  });

  const result = await poll('scheduled', harness.deps);

  expect(harness.fetchCalls).toBe(1);
  expect(result.networkAttempted).toBe(true);
  expect(result.notice).toBeNull();
  expect(result.state.unreadIds).toEqual(['new']);
  expect(result.state.lastAttemptAt).toBe('2026-08-29T00:00:00.000Z');
});

test('network work completes before the state mutation lock begins', async () => {
  const events: string[] = [];
  const harness = pollHarness({ events });

  await poll('scheduled', harness.deps);

  expect(events).toEqual(['load', 'fetch:start', 'fetch:end', 'mutate:start', 'mutate:end']);
});

test('first successful response establishes an all-read baseline', async () => {
  const result = await poll('scheduled', pollHarness({ fetchResult: [post('2'), post('1')] }).deps);

  expect(result.state.initializedAt).toBe('2026-08-29T00:00:00.000Z');
  expect(result.state.knownIds).toEqual(['1', '2']);
  expect(result.state.unreadIds).toEqual([]);
});

test('empty first success establishes an empty baseline', async () => {
  const result = await poll('scheduled', pollHarness({ fetchResult: [] }).deps);

  expect(result.state.initializedAt).toBe('2026-08-29T00:00:00.000Z');
  expect(result.state.cachedPosts).toEqual([]);
  expect(result.state.unreadIds).toEqual([]);
});

test('FeedError preserves cached posts and applies the exact backoff progression', async () => {
  const harness = pollHarness({
    state: stateWith({
      initializedAt: '2026-08-28T00:00:00.000Z', knownIds: ['old'], unreadIds: ['old'], cachedPosts: [post('old')],
    }),
    fetchResult: new FeedError('timeout', 'private details must not persist'),
  });
  const clock = harness.deps.clock as FakeClock;
  const expectedMinutes = [2, 4, 8, 16, 30, 30];
  let result = await poll('force', harness.deps);

  for (const minutes of expectedMinutes) {
    expect(result.state.cachedPosts).toEqual([post('old')]);
    expect(result.state.unreadIds).toEqual(['old']);
    expect(result.state.lastError).toBe('timeout');
    expect(Date.parse(result.state.nextRetryAt!) - Date.parse(result.state.lastAttemptAt!)).toBe(minutes * 60_000);
    clock.advance(minutes * 60_000);
    result = await poll('force', harness.deps);
  }

  expect(harness.fetchCalls).toBe(7);
});

test('unknown fetch errors are recorded as network without leaking raw messages', async () => {
  const harness = pollHarness();
  harness.deps.fetchPosts = async () => { throw new Error('/secret/path token=abc'); };

  const result = await poll('scheduled', harness.deps);

  expect(result.state.lastError).toBe('network');
  expect(JSON.stringify(result.state)).not.toContain('/secret/path');
  expect(result.notice).toBeNull();
});

test('scheduled duplicate guard skips before 30 seconds and permits exactly 30 seconds', async () => {
  const state = stateWith({ lastAttemptAt: '2026-08-29T00:00:00.000Z' });
  const early = pollHarness({ state, now: '2026-08-29T00:00:29.999Z' });
  const boundary = pollHarness({ state, now: '2026-08-29T00:00:30.000Z' });

  expect((await poll('scheduled', early.deps)).networkAttempted).toBe(false);
  expect(early.fetchCalls).toBe(0);
  expect((await poll('scheduled', boundary.deps)).networkAttempted).toBe(true);
  expect(boundary.fetchCalls).toBe(1);
});

test('scheduled backoff skips in the future, but permits equal and expired retry times', async () => {
  const future = pollHarness({ state: stateWith({ nextRetryAt: '2026-08-29T00:00:00.001Z' }) });
  const equal = pollHarness({ state: stateWith({ nextRetryAt: '2026-08-29T00:00:00.000Z' }) });
  const expired = pollHarness({ state: stateWith({ nextRetryAt: '2026-08-28T23:59:59.999Z' }) });

  expect((await poll('scheduled', future.deps)).networkAttempted).toBe(false);
  expect((await poll('scheduled', equal.deps)).networkAttempted).toBe(true);
  expect((await poll('scheduled', expired.deps)).networkAttempted).toBe(true);
});

test('scheduled polls evaluate duplicate suppression before backoff and never mutate when skipped', async () => {
  const harness = pollHarness({ state: stateWith({
    lastAttemptAt: '2026-08-29T00:00:00.000Z', nextRetryAt: '2026-08-29T00:30:00.000Z',
  }), now: '2026-08-29T00:00:20.000Z' });

  const result = await poll('scheduled', harness.deps);

  expect(result).toMatchObject({ networkAttempted: false, notice: null });
  expect(harness.events).toEqual(['load']);
});

test('forced polling bypasses both scheduled guards', async () => {
  const harness = pollHarness({ state: stateWith({
    lastAttemptAt: '2026-08-29T00:00:00.000Z', nextRetryAt: '2026-08-29T00:30:00.000Z',
  }), now: '2026-08-29T00:00:01.000Z' });

  const result = await poll('force', harness.deps);

  expect(result.networkAttempted).toBe(true);
  expect(harness.fetchCalls).toBe(1);
});

test('successful recovery clears recoveryPending and marks all returned posts unread', async () => {
  const result = await poll('scheduled', pollHarness({
    state: stateWith({ recoveryPending: true }), fetchResult: [post('recovered')],
  }).deps);

  expect(result.state.recoveryPending).toBe(false);
  expect(result.state.unreadIds).toEqual(['recovered']);
});

test('load failure returns sanitized recovery state without fetching', async () => {
  const harness = pollHarness();
  harness.deps.loadState = async () => { throw new Error('/private/state.json'); };

  const result = await poll('scheduled', harness.deps);

  expect(result).toMatchObject({ networkAttempted: false, notice: 'state' });
  expect(result.state).toEqual(stateWith({ recoveryPending: true }));
  expect(harness.fetchCalls).toBe(0);
  expect(JSON.stringify(result)).not.toContain('/private/state.json');
});

test('mutation failure after success returns the loaded cache and a state notice', async () => {
  const cached = stateWith({ initializedAt: '2026-08-28T00:00:00.000Z', knownIds: ['old'], cachedPosts: [post('old')] });
  const harness = pollHarness({ state: cached, fetchResult: [post('new')] });
  harness.deps.mutateState = async () => { throw new Error('StateStoreError: /private/secret'); };

  const result = await poll('scheduled', harness.deps);

  expect(result).toEqual({ state: cached, networkAttempted: true, notice: 'state' });
  expect(JSON.stringify(result)).not.toContain('/private/secret');
});

test('mutation failure after a feed failure returns the loaded cache and a state notice', async () => {
  const cached = stateWith({ initializedAt: '2026-08-28T00:00:00.000Z', consecutiveFailures: 2, lastError: 'http' });
  const harness = pollHarness({ state: cached, fetchResult: new FeedError('http', 'HTTP 500') });
  harness.deps.mutateState = async () => { throw new Error('StateStoreError: raw disk failure'); };

  const result = await poll('scheduled', harness.deps);

  expect(result).toEqual({ state: cached, networkAttempted: true, notice: 'state' });
  expect(result.state.lastAttemptAt).toBeNull();
});

test('polling never mutates loaded state, posts, or dependencies and attempts at most one fetch', async () => {
  const sourcePost = post('new');
  const cached = stateWith({ initializedAt: '2026-08-28T00:00:00.000Z', knownIds: ['old'], cachedPosts: [post('old')] });
  Object.freeze(cached.knownIds);
  Object.freeze(cached.unreadIds);
  Object.freeze(cached.cachedPosts);
  Object.freeze(cached);
  Object.freeze(sourcePost);
  const harness = pollHarness({ state: cached, fetchResult: [sourcePost] });
  const deps = harness.deps;

  const result = await poll('force', deps);

  expect(harness.fetchCalls).toBe(1);
  expect(result.state).not.toBe(cached);
  expect(cached.knownIds).toEqual(['old']);
  expect(sourcePost).toEqual(post('new'));
  expect(harness.deps).toBe(deps);
});

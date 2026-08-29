import { expect, test } from 'bun:test';
import {
  applyFailedPoll,
  applySuccessfulPoll,
  createInitialState,
  markAllRead,
  nextBackoffMinutes,
  parseState,
  selectCachedPosts,
} from '../src/state/model';
import { post, stateWith } from './helpers/factories';

const first = '2026-08-29T00:00:00.000Z';
const second = '2026-08-29T00:02:00.000Z';

test('uses a non-empty first success as an all-read baseline', () => {
  const state = applySuccessfulPoll(createInitialState(), [post('1'), post('2')], first);

  expect(state.initializedAt).toBe(first);
  expect(state.knownIds).toEqual(['1', '2']);
  expect(state.unreadIds).toEqual([]);
  expect(state.cachedPosts.map(({ id }) => id)).toEqual(['2', '1']);
});

test('uses a recognized empty first success as an initialized baseline', () => {
  const state = applySuccessfulPoll(createInitialState(), [], first);
  const later = applySuccessfulPoll(state, [post('1')], second);

  expect(state.initializedAt).toBe(first);
  expect(state.unreadIds).toEqual([]);
  expect(later.unreadIds).toEqual(['1']);
});

test('marks every recovery fetch item unread and clears recovery mode', () => {
  const state = applySuccessfulPoll(createInitialState({ recoveryPending: true }), [post('1'), post('2')], first);

  expect(state.initializedAt).toBe(first);
  expect(state.recoveryPending).toBe(false);
  expect(state.unreadIds).toEqual(['2', '1']);
});

test('marks later unknown IDs unread but never re-alerts known IDs', () => {
  const baseline = applySuccessfulPoll(createInitialState(), [post('1')], first);
  const update = applySuccessfulPoll(baseline, [post('2'), post('1')], second);
  const reappeared = applySuccessfulPoll(update, [post('1')], '2026-08-29T00:04:00.000Z');

  expect(update.unreadIds).toEqual(['2']);
  expect(reappeared.unreadIds).toEqual(['2']);
  expect(reappeared.knownIds).toEqual(['1', '2']);
});

test('keeps the first occurrence of a duplicated ID in an incoming response', () => {
  const state = applySuccessfulPoll(
    createInitialState({ recoveryPending: true }),
    [post('1', { text: 'first', publishedAt: first }), post('1', { text: 'later', publishedAt: second })],
    second,
  );

  expect(state.cachedPosts).toEqual([post('1', { text: 'first', publishedAt: first })]);
  expect(state.unreadIds).toEqual(['1']);
});

test('retains every unread cached post while pruning read history to the newest 100', () => {
  const unread = post('unread', { publishedAt: '2025-01-01T00:00:00.000Z' });
  const reads = Array.from({ length: 101 }, (_, index) => post(`read-${String(index).padStart(3, '0')}`, {
    publishedAt: `2026-08-29T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
  }));
  const state = stateWith({ knownIds: [unread.id, ...reads.map(({ id }) => id)].sort(), unreadIds: [unread.id], cachedPosts: [unread, ...reads] });

  const selected = selectCachedPosts(state.cachedPosts, state.unreadIds);
  expect(selected).toHaveLength(101);
  expect(selected.some(({ id }) => id === unread.id)).toBe(true);
  expect(selected.filter(({ id }) => id.startsWith('read-'))).toHaveLength(100);
});

test('orders cached posts and unread IDs by timestamp descending then ID descending', () => {
  const state = applySuccessfulPoll(
    createInitialState({ recoveryPending: true }),
    [post('a', { publishedAt: first }), post('b', { publishedAt: first }), post('z', { publishedAt: second }), post('none', { publishedAt: null })],
    second,
  );

  expect(state.cachedPosts.map(({ id }) => id)).toEqual(['z', 'b', 'a', 'none']);
  expect(state.unreadIds).toEqual(['z', 'b', 'a', 'none']);
});

test('uses UTF-16 opaque ID order for known IDs and equal or unavailable post ties', () => {
  const state = applySuccessfulPoll(
    createInitialState({ recoveryPending: true }),
    [
      post('z', { publishedAt: null }),
      post('\u00e4', { publishedAt: null }),
      post('\u{10000}', { publishedAt: first }),
      post('\uE000', { publishedAt: first }),
    ],
    second,
  );

  expect(state.knownIds).toEqual(['z', '\u00e4', '\u{10000}', '\uE000']);
  expect(state.cachedPosts.map(({ id }) => id)).toEqual(['\uE000', '\u{10000}', '\u00e4', 'z']);
  expect(state.unreadIds).toEqual(['\uE000', '\u{10000}', '\u00e4', 'z']);
});

test('mark all read clears unread IDs but permanently retains known IDs', () => {
  const state = stateWith({ knownIds: ['1', '2'], unreadIds: ['2', '1'], cachedPosts: [post('2'), post('1')] });
  const read = markAllRead(state);
  const reappeared = applySuccessfulPoll(read, [post('1')], second);

  expect(read.unreadIds).toEqual([]);
  expect(read.knownIds).toEqual(['1', '2']);
  expect(reappeared.unreadIds).toEqual([]);
});

test('uses exact exponential backoff with thirty-minute saturation', () => {
  expect([0, 1, 2, 3, 4, 5, 99].map(nextBackoffMinutes)).toEqual([2, 2, 4, 8, 16, 30, 30]);
});

test('failure preserves cache, records only category, and success resets error/backoff metadata', () => {
  const source = stateWith({
    cachedPosts: [post('1')],
    unreadIds: ['1'],
    knownIds: ['1'],
    lastSuccessAt: first,
    consecutiveFailures: 2,
  });
  const failed = applyFailedPoll(source, 'timeout', second);
  const recovered = applySuccessfulPoll(failed, [post('1')], '2026-08-29T00:05:00.000Z');

  expect(failed.cachedPosts).toEqual(source.cachedPosts);
  expect(failed.unreadIds).toEqual(source.unreadIds);
  expect(failed.lastAttemptAt).toBe(second);
  expect(failed.lastSuccessAt).toBe(first);
  expect(failed.consecutiveFailures).toBe(3);
  expect(failed.lastError).toBe('timeout');
  expect(failed.nextRetryAt).toBe('2026-08-29T00:10:00.000Z');
  expect(recovered.lastAttemptAt).toBe('2026-08-29T00:05:00.000Z');
  expect(recovered.lastSuccessAt).toBe('2026-08-29T00:05:00.000Z');
  expect(recovered.consecutiveFailures).toBe(0);
  expect(recovered.nextRetryAt).toBeNull();
  expect(recovered.lastError).toBeNull();
});

test('does not mutate transition or selection inputs', () => {
  const initial = stateWith({ knownIds: ['1'], cachedPosts: [post('1')], unreadIds: [] });
  const incoming = [post('2'), post('1')];
  const initialSnapshot = structuredClone(initial);
  const incomingSnapshot = structuredClone(incoming);
  const cached = [post('1'), post('2')];
  const unread = ['2'];
  const cachedSnapshot = structuredClone(cached);
  const unreadSnapshot = structuredClone(unread);

  applySuccessfulPoll(initial, incoming, second);
  applyFailedPoll(initial, 'network', second);
  markAllRead(initial);
  selectCachedPosts(cached, unread);

  expect(initial).toEqual(initialSnapshot);
  expect(incoming).toEqual(incomingSnapshot);
  expect(cached).toEqual(cachedSnapshot);
  expect(unread).toEqual(unreadSnapshot);
});

test('parseState strictly rejects malformed shapes and unsupported versions', () => {
  for (const value of [null, [], {}, stateWith({ version: 2 as 1 }), stateWith({ unreadIds: [1] as unknown as string[] }), stateWith({ lastError: 'secret stack trace' })]) {
    expect(() => parseState(value)).toThrow();
  }
});

test('parseState validates post fields and timestamp fields', () => {
  expect(() => parseState(stateWith({ cachedPosts: [{ ...post('1'), publishedAt: 'not-a-time' }] }))).toThrow();
  expect(() => parseState(stateWith({ lastAttemptAt: '2026-08-29T00:00:00' }))).toThrow();
  expect(() => parseState(stateWith({ cachedPosts: [{ ...post('1'), url: 3 as unknown as string }] }))).toThrow();
});

test('parseState rejects persisted post URLs outside the validated X/Twitter HTTPS boundary', () => {
  for (const url of [
    'https://example.invalid/post/1',
    'https://user:password@x.com/thsottiaux/status/1',
    'http://x.com/thsottiaux/status/1',
  ]) {
    expect(() => parseState(stateWith({ knownIds: ['1'], cachedPosts: [post('1', { url })] }))).toThrow();
  }
});

test('parseState rejects unread IDs without cached posts', () => {
  expect(() => parseState(stateWith({ knownIds: ['u'], unreadIds: ['u'], cachedPosts: [] }))).toThrow();
});

test('parseState normalizes known IDs, cached posts, unread IDs, and cache retention', () => {
  const parsed = parseState(stateWith({
    knownIds: ['z', 'a', 'z'],
    unreadIds: ['a', 'z', 'a'],
    cachedPosts: [post('a', { publishedAt: first }), post('z', { publishedAt: second })],
  }));

  expect(parsed.knownIds).toEqual(['a', 'z']);
  expect(parsed.unreadIds).toEqual(['z', 'a']);
  expect(parsed.cachedPosts.map(({ id }) => id)).toEqual(['z', 'a']);
});

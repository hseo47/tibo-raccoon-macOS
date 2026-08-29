import type { Post, RaccoonState } from '../../src/domain';

export function post(id: string, overrides: Partial<Post> = {}): Post {
  return {
    id,
    text: `post ${id}`,
    publishedAt: '2026-08-29T00:00:00.000Z',
    url: `https://x.com/thsottiaux/status/${id}`,
    ...overrides,
  };
}

export function stateWith(overrides: Partial<RaccoonState> = {}): RaccoonState {
  return {
    version: 1,
    initializedAt: null,
    recoveryPending: false,
    knownIds: [],
    unreadIds: [],
    cachedPosts: [],
    lastAttemptAt: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    nextRetryAt: null,
    lastError: null,
    ...overrides,
  };
}

import type { FeedErrorKind, Post, RaccoonState } from '../domain';
import { parseRfc3339 } from '../feed/normalize';

const MAX_READ_POSTS = 100;
const ERROR_KINDS: ReadonlySet<FeedErrorKind> = new Set(['timeout', 'http', 'oversize', 'malformed', 'network']);

export function createInitialState(options: { recoveryPending?: boolean } = {}): RaccoonState {
  return {
    version: 1,
    initializedAt: null,
    recoveryPending: options.recoveryPending === true,
    knownIds: [],
    unreadIds: [],
    cachedPosts: [],
    lastAttemptAt: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    nextRetryAt: null,
    lastError: null,
  };
}

export function parseState(value: unknown): RaccoonState {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error('Invalid state');
  }

  const initializedAt = parseOptionalTimestamp(value.initializedAt);
  const lastAttemptAt = parseOptionalTimestamp(value.lastAttemptAt);
  const lastSuccessAt = parseOptionalTimestamp(value.lastSuccessAt);
  const nextRetryAt = parseOptionalTimestamp(value.nextRetryAt);
  const consecutiveFailures = value.consecutiveFailures;
  if (
    typeof value.recoveryPending !== 'boolean' ||
    typeof consecutiveFailures !== 'number' ||
    !Number.isInteger(consecutiveFailures) ||
    consecutiveFailures < 0
  ) {
    throw new Error('Invalid state');
  }

  const knownIds = parseIds(value.knownIds).sort(compareIdsAscending);
  const unreadIdSet = new Set(parseIds(value.unreadIds));
  const knownIdSet = new Set(knownIds);
  if ([...unreadIdSet].some((id) => !knownIdSet.has(id))) {
    throw new Error('Invalid state');
  }

  const cachedPosts = parsePosts(value.cachedPosts);
  if (cachedPosts.some(({ id }) => !knownIdSet.has(id))) {
    throw new Error('Invalid state');
  }

  const lastError = parseLastError(value.lastError);
  return {
    version: 1,
    initializedAt,
    recoveryPending: value.recoveryPending,
    knownIds,
    unreadIds: orderUnreadIds(unreadIdSet, cachedPosts),
    cachedPosts: selectCachedPosts(cachedPosts, [...unreadIdSet]),
    lastAttemptAt,
    lastSuccessAt,
    consecutiveFailures,
    nextRetryAt,
    lastError,
  };
}

export function applySuccessfulPoll(state: RaccoonState, posts: readonly Post[], nowIso: string): RaccoonState {
  const incoming = firstPostsById(posts);
  const knownIdSet = new Set(state.knownIds);
  const isFirstSuccess = state.initializedAt === null;
  const unreadIdSet = new Set(state.unreadIds);

  for (const item of incoming) {
    if (state.recoveryPending || (!isFirstSuccess && !knownIdSet.has(item.id))) {
      unreadIdSet.add(item.id);
    }
    knownIdSet.add(item.id);
  }

  const cachedById = new Map<string, Post>();
  for (const item of incoming) {
    cachedById.set(item.id, clonePost(item));
  }
  for (const item of state.cachedPosts) {
    if (!cachedById.has(item.id)) {
      cachedById.set(item.id, clonePost(item));
    }
  }
  const cachedPosts = selectCachedPosts([...cachedById.values()], [...unreadIdSet]);

  return {
    version: 1,
    initializedAt: isFirstSuccess ? nowIso : state.initializedAt,
    recoveryPending: false,
    knownIds: [...knownIdSet].sort(compareIdsAscending),
    unreadIds: orderUnreadIds(unreadIdSet, cachedPosts),
    cachedPosts,
    lastAttemptAt: nowIso,
    lastSuccessAt: nowIso,
    consecutiveFailures: 0,
    nextRetryAt: null,
    lastError: null,
  };
}

export function applyFailedPoll(state: RaccoonState, kind: FeedErrorKind, nowIso: string): RaccoonState {
  const consecutiveFailures = state.consecutiveFailures + 1;
  const nextRetryAt = new Date(Date.parse(nowIso) + nextBackoffMinutes(consecutiveFailures) * 60_000).toISOString();

  return {
    ...cloneStateCollections(state),
    lastAttemptAt: nowIso,
    consecutiveFailures,
    nextRetryAt,
    lastError: kind,
  };
}

export function markAllRead(state: RaccoonState): RaccoonState {
  return { ...cloneStateCollections(state), unreadIds: [] };
}

export function nextBackoffMinutes(consecutiveFailures: number): 2 | 4 | 8 | 16 | 30 {
  if (consecutiveFailures <= 1) return 2;
  if (consecutiveFailures === 2) return 4;
  if (consecutiveFailures === 3) return 8;
  if (consecutiveFailures === 4) return 16;
  return 30;
}

export function selectCachedPosts(posts: readonly Post[], unreadIds: readonly string[]): Post[] {
  const unreadIdSet = new Set(unreadIds);
  const uniquePosts = firstPostsById(posts).sort(comparePosts);
  const unreadPosts = uniquePosts.filter(({ id }) => unreadIdSet.has(id));
  const readPosts = uniquePosts.filter(({ id }) => !unreadIdSet.has(id)).slice(0, MAX_READ_POSTS);
  return [...unreadPosts, ...readPosts].sort(comparePosts).map(clonePost);
}

function parseIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new Error('Invalid state');
  }
  return [...new Set(value)];
}

function parsePosts(value: unknown): Post[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid state');
  }
  const posts: Post[] = [];
  for (const item of value) {
    const publishedAt = item !== null && isRecord(item) ? parseOptionalTimestamp(item.publishedAt) : null;
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' || item.id.length === 0 ||
      typeof item.text !== 'string' ||
      (item.publishedAt !== null && publishedAt === null) ||
      (item.url !== null && typeof item.url !== 'string')
    ) {
      throw new Error('Invalid state');
    }
    posts.push({ id: item.id, text: item.text, publishedAt, url: item.url as string | null });
  }
  return firstPostsById(posts);
}

function parseOptionalTimestamp(value: unknown): string | null {
  if (value === null) return null;
  if (parseRfc3339(value) === null) throw new Error('Invalid state');
  return parseRfc3339(value);
}

function parseLastError(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !ERROR_KINDS.has(value as FeedErrorKind)) {
    throw new Error('Invalid state');
  }
  return value;
}

function orderUnreadIds(unreadIds: ReadonlySet<string>, posts: readonly Post[]): string[] {
  const postById = new Map(posts.map((item) => [item.id, item]));
  return [...unreadIds].sort((left, right) => {
    const leftPost = postById.get(left);
    const rightPost = postById.get(right);
    if (leftPost !== undefined && rightPost !== undefined) return comparePosts(leftPost, rightPost);
    if (leftPost !== undefined) return -1;
    if (rightPost !== undefined) return 1;
    return right.localeCompare(left);
  });
}

function firstPostsById(posts: readonly Post[]): Post[] {
  const byId = new Map<string, Post>();
  for (const item of posts) {
    if (!byId.has(item.id)) byId.set(item.id, clonePost(item));
  }
  return [...byId.values()];
}

function cloneStateCollections(state: RaccoonState): RaccoonState {
  return {
    ...state,
    knownIds: [...state.knownIds],
    unreadIds: [...state.unreadIds],
    cachedPosts: state.cachedPosts.map(clonePost),
  };
}

function clonePost(post: Post): Post {
  return { ...post };
}

function compareIdsAscending(left: string, right: string): number {
  return left.localeCompare(right);
}

function comparePosts(left: Post, right: Post): number {
  if (left.publishedAt === null && right.publishedAt !== null) return 1;
  if (left.publishedAt !== null && right.publishedAt === null) return -1;
  if (left.publishedAt !== right.publishedAt) {
    return left.publishedAt === null || right.publishedAt === null ? 0 : right.publishedAt.localeCompare(left.publishedAt);
  }
  return right.id.localeCompare(left.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
